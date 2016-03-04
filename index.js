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
require('datejs');
Promise.promisifyAll(Showtimes.prototype);

var CONFIG = lambdaConfig.fetch({ S3Bucket: 'showtimes-bot-config', S3File: 'config.json' });
var db = new AWS.DynamoDB({ region: 'eu-west-1' });

var bot, botan;
lambdaConfig.on('ready', function () {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || CONFIG.telegram_bot_key, { polling: false, webhook: false });
  botan = require('botanio')(CONFIG.botanio_token);
});

var help_text = 'I can show you nearby theaters and showtimes. Tell me, what can I do for you?\n\n';
help_text += '-> 🎬 /movies or /showtimes \\[query\] - Shows movie showtimes and nearby theaters screening them. You can filter the movies and dates with `query`, for example `/movies tomorrow` will show showtimes for tomorrow, and `/movies star wars` will only show showtimes for movies containing star wars in their title.\n\n';
help_text += '-> 📽 /theaters \\[query\] - Shows nearby theaters and the movies they are screening. You can filter the theaters and dates with `query`, for example `/theaters tomorrow` will show theaters and their showtimes for tomorrow, and `/theaters Verdi` will only show nearby theaters called Verdi.\n\n';
help_text += '-> 📍 /setlocation - Sets your location for future reference';
var help_group_append_text = '\n\n*Note* that in groups you have to append @ShowtimesBot to all commands, e.g. "/setlocation@ShowtimesBot" or "/movies@ShowtimesBot"';

var deferred_location_help_text = 'Send me your location using the location button on Telegram, or send it manually with "/setlocation city, country or zip code".';
var deferred_location_group_help_text = 'Add your location to the /setlocation@ShowtimesBot command, like "/setlocation@ShowtimesBot city, country or zip code".';

var empty_text = 'Sorry, I couldn\'t find any %s matching %s.';
var empty_text_expanded = 'Sorry, I couldn\'t find any %s matching %s for %s near %s.';
var no_location_text = 'These are not the theaters you\'re looking for...\nTo set your preferred location, use the /setlocation command.';
var error_showtimes_text = 'Error finding showtimes. Please try again in a few minutes.';
var error_theaters_text = 'Error finding theaters. Please try again in a few minutes.';
var error_setting_location_text = 'An error happened setting your new location, please try again in a few minutes.';
var location_set_text = 'I\'ve set your location to %s.';
var location_set_group_append_text = ' Note that this location will only be used for this group.';

var default_location = 'Barcelona, Spain';

// Process unhandled messages
var onHelp = function (msg, cb, matches) {
  botan.track(msg, '/help');
  if (msg.chat.type !== 'private' && (!matches || !matches[1])) return cb(); // Ignore group messages not directed to me

  bot.sendMessage(msg.chat.id, help_text + ((msg.chat.type !== 'private') ? help_group_append_text : ''), {
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  }).then(function () {
    cb();
  }).catch(cb);
};

var onSetLocation = function (msg, cb, matches) {
  botan.track(msg, '/setlocation location');
  if (msg.chat.type !== 'private' && (!matches || !matches[1])) return cb(); // Ignore group messages not directed to me
  setLocation(msg, matches[2], cb);
};

var onSetDeferedLocation = function (msg, cb, matches) {
  botan.track(msg, '/setlocation');
  if (msg.chat.type !== 'private' && (!matches || !matches[1])) return cb(); // Ignore group messages not directed to me
  var response = deferred_location_help_text;
  if (msg.chat.type !== 'private') {
    response = deferred_location_group_help_text;
  }
  bot.sendMessage(msg.chat.id, response).then(function () {
    cb();
  }).catch(cb);
};

var onLocation = function (msg, cb) {
  botan.track(msg, 'location');
  if (msg.chat.type !== 'private') return cb(); // Ignore all but private messages, TODO: be able to set location in a group
  setLocation(msg, util.format('%s,%s', msg.location.latitude, msg.location.longitude), cb);
};

var onTheaters = function (msg, cb, matches) {
  botan.track(msg, '/theaters');
  if (msg.chat.type !== 'private' && (!matches || !matches[1])) return cb(); // Ignore group messages not directed to me
  bot.sendChatAction(msg.chat.id, 'typing');

  var no_location = false;
  getLocationForUser(msg.chat.id).then(function (location) {
    if (!location) {
      location = default_location;
      no_location = true;
    }

    var api = new Showtimes(location);
    return api.getTheatersAsync(matches[2]);
  }).then(function (theaters) {
    var response = formatTheaters(msg, theaters, matches[2]);
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
    onError(err, msg, error_theaters_text, matches[2], 'theaters', cb);
  });
};

var onShowtimes = function (msg, cb, matches) {
  botan.track(msg, '/showtimes');
  if (msg.chat.type !== 'private' && (!matches || !matches[1])) return cb(); // Ignore group messages not directed to me
  bot.sendChatAction(msg.chat.id, 'typing');

  var location = false;
  var retried = false;
  var moviesHandler = function (movies) {
    if (!movies.data.length && !retried) {
      // If no movies found this way, it may be due to a time search like /movies tomorrow
      // try seting the date directly to the search
      retried = true;
      var d = Date.parse(matches[2]);
      if (d !== null) {
        var api = new Showtimes(location || default_location, { date: dateDiff(d) });
        return api.getMoviesAsync().then(moviesHandler);
      }
    }

    var response = formatMovies(msg, movies, matches[2]);
    if (!location) response.push(no_location_text);
    return Promise.mapSeries(response, function (text) {
      return bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
    });
  };

  getLocationForUser(msg.chat.id).then(function (_location) {
    if (_location) {
      location = _location;
    }

    var api = new Showtimes(location || default_location);
    return api.getMoviesAsync(matches[2]);
  }).then(moviesHandler).then(function () {
    cb();
  }).catch(function (err) {
    onError(err, msg, error_showtimes_text, matches[2], 'showtimes', cb);
  });
};

var onMovie = function (msg, cb, matches) {
  botan.track(msg, '/movie_id');
  bot.sendChatAction(msg.chat.id, 'typing');

  var no_location = false;
  getLocationForUser(msg.chat.id).then(function (location) {
    if (!location) {
      location = default_location;
      no_location = true;
    }

    var api = new Showtimes(location, { date: matches[1] });
    return api.getMovieAsync(matches[2]);
  }).then(function (movie) {
    var response = formatMovies(msg, movie, matches[2]);
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
    onError(err, msg, error_showtimes_text, matches[2], 'showtimes', cb);
  });
};

var setLocation = function (msg, location, cb) {
  db.updateItem({
    Key: {
      chatid: {
        N: msg.chat.id + ''
      }
    },
    TableName: 'showtimesbot-locations',
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
    var response = err ? error_setting_location_text : util.format(location_set_text, location);
    if (msg.chat.type !== 'private') response += location_set_group_append_text;
    bot.sendMessage(msg.chat.id, response).then(function () {
      cb();
    }).catch(cb);
  });
};

var getLocationForUser = function (user_id) {
  return new Promise(function (fulfill, reject) {
    db.getItem({
      Key: {
        chatid: {
          N: user_id + ''
        }
      },
      TableName: 'showtimesbot-locations'
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

  var thingParser = function (thing) {
    var partialResponse = util.format('%s *%s*\n', (type === 'movies' ? '🎬' : '📽'), thing.name);
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
        partialResponse += util.format('%s %s - %s\n', (type === 'theaters' ? '🎬' : '📽'), otherThing.name, showtimes.join(' '));
      });
    }

    if (type === 'movies' && thing.more_theaters) {
      partialResponse += util.format('_Show more theaters_ -> /movie\\_%d\\_%s\n', dateDiff(things.date), thing.id);
    }

    if (!noOtherThings) {
      response.push(partialResponse);
      noThings = false;
    }
  };

  if (util.isArray(things.data)) {
    things.data.forEach(thingParser);
  } else {
    thingParser(things.data);
  }

  if (noThings) {
    return [ util.format(empty_text_expanded, type, query, things.date, things.location) ];
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

var dateDiff = function (date) {
  return Math.floor(Date.today().getElapsed(Date.parse(date))/1000/60/60/24);
};

exports.handler = lambdaConfig.handler(telegramHandler({
  onMessage: onHelp,
  onText: [
    {
      matches: /^\/setlocation(@ShowtimesBot)?\s+(.+)\s*$/i,
      handler: onSetLocation
    },
    {
      matches: /^\/setlocation(@ShowtimesBot)?\s*$/i,
      handler: onSetDeferedLocation
    },
    {
      matches: /^\/theaters(@ShowtimesBot)?(?:\s+(.+)\s*)?$/i,
      handler: onTheaters
    },
    {
      matches: /^\/(?:showtimes|movies)(@ShowtimesBot)?(?:\s+(.+)\s*)?$/i,
      handler: onShowtimes
    },
    {
      matches: /^\/help(@ShowtimesBot)?/i,
      handler: onHelp
    },
    {
      matches: /^\/movie_(\d+)_(.+)$/i,
      handler: onMovie
    }
  ],
  onLocation: onLocation
}));
