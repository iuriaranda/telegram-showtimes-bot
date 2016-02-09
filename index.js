var telegramHandler = require('lambda-telegram-bot-handler');
var TelegramBot = require('node-telegram-bot-api');
var util = require('util');
var lambdaConfig = require('lambda-remote-config');
var _ = require('underscore');
var Promise = require('bluebird');
var Showtimes = require('showtimes');
Promise.promisifyAll(Showtimes.prototype);

var api = new Showtimes('Barcelona, Spain');
var CONFIG = lambdaConfig.fetch({ S3Bucket: 'showtimesbot-config', S3File: 'config.json' });

var bot;
lambdaConfig.on('ready', function () {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || CONFIG.telegram_bot_key, { polling: false, webhook: false });
});

var help_text = 'I can help you find nearby theaters and showtimes. Tell me, what are you looking for?\n\n';
// help_text += '/setlocation - Sets your location for future reference\n';
help_text += '/movies or /showtimes - Shows the movies that are projecting in near theaters\n';
help_text += '/theaters - Shows nearby theaters, and the movies they are screening\n';

var empty_movies_text = 'Sorry, I couldn\'t find any showtimes matching %s';
var empty_theaters_text = 'Sorry, I couldn\'t find any theaters matching %s';

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

var onSetLocation = function (msg, matches, cb) {
  bot.sendMessage(msg.chat.id, 'TODO setlocation').then(function () {
    cb();
  }).catch(cb);
};

var onTheaters = function (msg, matches, cb) {
  bot.sendChatAction(msg.chat.id, 'typing');

  api.getTheatersAsync(matches[1]).then(function (theaters) {
    if (theaters.length) {
      return Promise.mapSeries(formatTheaters(msg, theaters), function (text) {
        return bot.sendMessage(msg.chat.id, text, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
      });
    } else {
      return bot.sendMessage(msg.chat.id, util.format(empty_theaters_text, matches[1]));
    }
  }).then(function () {
    cb();
  }).catch(function (err) {
    onError(err, msg, 'Error fetching theaters', cb);
  });
};

var onShowtimes = function (msg, matches, cb) {
  bot.sendChatAction(msg.chat.id, 'typing');

  api.getMoviesAsync(matches[1]).then(function (movies) {
    if (movies.length) {
      return Promise.mapSeries(formatMovies(msg, movies), function (text) {
        return bot.sendMessage(msg.chat.id, text, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });
      });
    } else {
      return bot.sendMessage(msg.chat.id, util.format(empty_movies_text, matches[1]));
    }
  }).then(function () {
    cb();
  }).catch(function (err) {
    onError(err, msg, 'Error fetching theaters', cb);
  });
};

var onError = function (err, msg, err_msg, cb) {
  console.error(err);
  bot.sendMessage(msg.chat.id, err_msg).then(function () {
    cb();
  }).catch(cb);
};

var formatThings = function (msg, things, type) {
  var response = [util.format('Here are the %s projecting near you:\n', type)];
  var otherType = type === 'movies' ? 'theaters' : 'movies';
  var mod = type === 'movies' ? 10 : 5;

  things.forEach(function (thing) {
    response.push(util.format('*%s*\n', thing.name));
    var i = response.length - 1;
    if (thing[otherType]) {
      thing[otherType].forEach(function (otherThing) {
        var showtimes = [];
        if (otherThing.showtime_tickets) {
          otherThing.showtimes.forEach(function (time) {
            showtimes.push(util.format('[%s](%s)', time, otherThing.showtime_tickets[time]));
          });
        } else {
          showtimes = otherThing.showtimes;
        }
        response[i] += util.format('%s - %s\n', otherThing.name, showtimes.join(' '));
      });
    }
  });
  return _.compact(_.map(response, function (line, l) {
    if (l%mod === 9) {
      return response.slice(l - l%mod, l + 1).join('\n');
    } else if (l === response.length - 1) {
      return response.slice(l - l%mod).join('\n');
    }
  }));
};

var formatMovies = function (msg, movies) {
  return formatThings(msg, movies, 'movies');
};

var formatTheaters = function (msg, theaters) {
  return formatThings(msg, theaters, 'theaters');
};

exports.handler = lambdaConfig.handler(telegramHandler({
  onMessage: onMessage,
  onText: [
    {
      matches: /^\/setlocation/,
      handler: onMessage
    },
    {
      matches: /^\/theaters(?:\s+(.+))?$/,
      handler: onTheaters
    },
    {
      matches: /^\/(?:showtimes|movies)(?:\s+(.+))?$/,
      handler: onShowtimes
    }
  ]
}));