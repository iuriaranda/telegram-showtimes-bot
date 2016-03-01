// Log uncaught exceptions
process.on('uncaughtException', function (error) {
  console.error('Uncaught Exception', error);
  process.exit(1);
});

var telegramHandler = require('lambda-telegram-bot-handler');
var TelegramBot = require('node-telegram-bot-api');
var util = require('util');
var lambdaConfig = require('lambda-remote-config');
var _ = require('underscore');
var Promise = require('bluebird');
var Showtimes = require('showtimes');
var AWS = require('aws-sdk');
Promise.promisifyAll(Showtimes.prototype);

var api = new Showtimes('Barcelona, Spain');
var CONFIG = lambdaConfig.fetch({ S3Bucket: 'showtimes-bot-config', S3File: 'config.json' });
var db = new AWS.DynamoDB({ region: 'eu-west-1' });

var bot;
lambdaConfig.on('ready', function () {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || CONFIG.telegram_bot_key, { polling: false, webhook: false });
});

var help_text = 'I can show you nearby theaters and showtimes. Tell me, what can I do for you?\n\n';
help_text += '-> /movies or /showtimes \\[query\] - Shows movie showtimes and nearby theaters screening them. You can filter the movies and dates with `query`, for example `/movies tomorrow` will show showtimes for tomorrow, and `/movies star wars` will only show showtimes for movies containing star wars in their title.\n\n';
help_text += '-> /theaters \\[query\] - Shows nearby theaters and the movies they are screening. You can filter the theaters and dates with `query`, for example `/theaters tomorrow` will show theaters and their showtimes for tomorrow, and `/theaters Verdi` will only show nearby theaters called Verdi.\n\n';
help_text += '-> /setlocation - Sets your location for future reference';

var deferred_location_help_text = 'Send me your location using the location button on Telegram, or send it manually with "/setlocation city, country or zip code".';

var empty_text = 'Sorry, I couldn\'t find any %s matching %s.';
var no_location_text = 'These are not the theaters you\'re looking for...\nTo set your preferred location, use the /setlocation command.';
var error_showtimes_text = 'Error finding showtimes. Please try again in a few minutes.';
var error_theaters_text = 'Error finding theaters. Please try again in a few minutes.';
var error_setting_location_text = 'An error happened setting your new location, please try again in a few minutes.';
var location_set_text = 'I\'ve set your location to %s.';

var default_location = 'Barcelona, Spain';

// Process unhandled messages
var onMessage = function (msg, cb) {
  if (msg.chat.type !== 'private') return cb(); // Ignore all but private messages

  bot.sendMessage(msg.from.id, help_text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  }).then(function () {
    cb();
  }).catch(cb);
};

var onSetLocation = function (msg, cb, matches) {
  setLocation(msg.chat.id, matches[1], cb);
};

var onSetDeferedLocation = function (msg, cb) {
  bot.sendMessage(msg.chat.id, deferred_location_help_text).then(function () {
    cb();
  }).catch(cb);
};

var onLocation = function (msg, cb) {
  if (msg.chat.type !== 'private') return cb(); // Ignore all but private messages, TODO: be able to set location in a group
  setLocation(msg.chat.id, util.format('%s,%s', msg.location.latitude, msg.location.longitude), cb);
};

var onTheaters = function (msg, cb, matches) {
  bot.sendChatAction(msg.chat.id, 'typing');

  var no_location = false;
  getLocationForUser(msg.chat.id).then(function (location) {
    if (!location) {
      location = default_location;
      no_location = true;
    }

    var api = new Showtimes(location);
    return api.getTheatersAsync(matches[1]);
  }).then(function (theaters) {
    var response = formatTheaters(msg, theaters, matches[1]);
    if (no_location) response.push(no_location_text);
    return Promise.mapSeries(response, function (text) {
      return bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
    });
  }).then(function () {
    cb();
  }).catch(function (err) {
    onError(err, msg, error_theaters_text, matches[1], 'theaters', cb);
  });
};

var onShowtimes = function (msg, cb, matches) {
  bot.sendChatAction(msg.chat.id, 'typing');

  var no_location = false;
  getLocationForUser(msg.chat.id).then(function (location) {
    if (!location) {
      location = default_location;
      no_location = true;
    }

    var api = new Showtimes(location);
    return api.getMoviesAsync(matches[1]);
  }).then(function (movies) {
    var response = formatMovies(msg, movies, matches[1]);
    if (no_location) response.push(no_location_text);
    return Promise.mapSeries(response, function (text) {
      return bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
    });
  }).then(function () {
    cb();
  }).catch(function (err) {
    onError(err, msg, error_showtimes_text, matches[1], 'showtimes', cb);
  });
};

var setLocation = function (id, location, cb) {
  db.updateItem({
    Key: {
      userid: {
        N: id + ''
      }
    },
    TableName: 'showtimesbot-users',
    UpdateExpression: 'SET #loc=:loc',
    ExpressionAttributeValues: {
      ':loc': {
        S: location
      }
    },
    ExpressionAttributeNames: {
      '#loc': 'location'
    }
  }, function (err) {
    if (err) console.log(err);
    bot.sendMessage(id, err ? error_setting_location_text : util.format(location_set_text, location)).then(function () {
      cb();
    }).catch(cb);
  });
};

var getLocationForUser = function (user_id) {
  return new Promise(function (fulfill, reject) {
    db.getItem({
      Key: {
        userid: {
          N: user_id + ''
        }
      },
      TableName: 'showtimesbot-users'
    }, function (err, data) {
      if (err) reject(err);
      else if (data.Item && data.Item.location && data.Item.location.S) fulfill(data.Item.location.S);
      else fulfill(null);
    });
  });
};

var onError = function (err, msg, err_msg, query, type, cb) {
  if (/Your query .+ did not match|No .+ were found/i.test(err)) {
    err_msg = util.format(empty_text, type, query);
  } else {
    console.error(err);
  }

  bot.sendMessage(msg.chat.id, err_msg).then(function () {
    cb();
  }).catch(cb);
};

var formatThings = function (msg, things, type, query) {
  var response = [ util.format('Here are the showtimes for %s near %s:\n', things.date, things.location) ];
  var otherType = type === 'movies' ? 'theaters' : 'movies';
  var mod = type === 'movies' ? 10 : 5;
  var noThings = true;

  things.data.forEach(function (thing) {
    var partialResponse = util.format('*%s*\n', thing.name);
    var noOtherThings = true;
    if (thing[otherType]) {
      thing[otherType].forEach(function (otherThing) {
        if (otherThing.name === '' || (otherThing.showtimes.length === 1 && otherThing.showtimes[0] === '')) return;
        noOtherThings = false;
        var showtimes = [];
        if (otherThing.showtime_tickets) {
          otherThing.showtimes.forEach(function (time) {
            showtimes.push(util.format('[%s](%s)', time, otherThing.showtime_tickets[time]));
          });
        } else {
          showtimes = otherThing.showtimes;
        }
        partialResponse += util.format('%s - %s\n', otherThing.name, showtimes.join(' '));
      });
    }

    if (!noOtherThings) {
      response.push(partialResponse);
      noThings = false;
    }
  });

  if (noThings) {
    return [ util.format(empty_text, type, query) ];
  } else {
    return _.compact(_.map(response, function (line, l) {
      if (l%mod === mod - 1) {
        return response.slice(l - l%mod, l + 1).join('\n');
      } else if (l === response.length - 1) {
        return response.slice(l - l%mod).join('\n');
      }
    }));
  }
};

var formatMovies = function (msg, movies, query) {
  return formatThings(msg, movies, 'movies', query);
};

var formatTheaters = function (msg, theaters, query) {
  return formatThings(msg, theaters, 'theaters', query);
};

exports.handler = lambdaConfig.handler(telegramHandler({
  onMessage: onMessage,
  onText: [
    {
      matches: /^\/setlocation\s+(.+)\s*$/,
      handler: onSetLocation
    },
    {
      matches: /^\/setlocation\s*$/,
      handler: onSetDeferedLocation
    },
    {
      matches: /^\/theaters(?:\s+(.+)\s*)?$/,
      handler: onTheaters
    },
    {
      matches: /^\/(?:showtimes|movies)(?:\s+(.+)\s*)?$/,
      handler: onShowtimes
    }
  ],
  onLocation: onLocation
}));
