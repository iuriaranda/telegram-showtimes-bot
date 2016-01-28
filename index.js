var telegramHandler = require('lambda-telegram-bots');
var Showtimes = require('showtimes');
var TelegramBot = require('node-telegram-bot-api');
var util = require('util');
var lambdaConfig = require('lambda-remote-config');

var api = new Showtimes('Barcelona, Spain');
var CONFIG = lambdaConfig.fetch({ S3Bucket: 'showtimesbot-config', S3File: 'config.json' });

var bot;
lambdaConfig.on('ready', function () {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN || CONFIG.telegram_bot_key, { polling: false, webhook: false });
});

var help_text = 'I can help you find nearby theaters and showtimes. Tell me, what are you looking for?\n\n';
help_text += '/setlocation - Sets your location for future reference\n';
help_text += '/movies - Shows the movies that are projecting in near theaters\n';

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
  bot.sendMessage(msg.from.id, 'TODO setlocation').then(function () {
    cb();
  }).catch(cb);
};

var onMovies = function (msg, matches, cb) {
  bot.sendMessage(msg.from.id, 'TODO movies').then(function () {
    cb();
  }).catch(cb);
};

var onMoviesInTheater = function (msg, matches, cb) {
  bot.sendMessage(msg.from.id, 'TODO movies in theater ' + matches[1]).then(function () {
    cb();
  }).catch(cb);
};

var onTheaters = function (msg, matches, cb) {
  bot.sendMessage(msg.from.id, 'TODO theaters').then(function () {
    cb();
  }).catch(cb);
};

var onTheatersForMovie = function (msg, matches, cb) {
  bot.sendMessage(msg.from.id, 'TODO theaters for movie ' + matches[1]).then(function () {
    cb();
  }).catch(cb);
};

var onShowtimesHelper = function (msg, matches, cb) {
  bot.sendMessage(msg.from.id, 'TODO showtimes').then(function () {
    cb();
  }).catch(cb);
};

exports.handler = lambdaConfig.handler(telegramHandler({
  onMessage: onMessage,
  onText: [
    {
      matches: /^\/setlocation/,
      handler: onSetLocation
    },
    {
      matches: /^\/movies\s*$/,
      handler: onMovies
    },
    {
      matches: /^\/movies (.+)/,
      handler: onMoviesInTheater
    },
    {
      matches: /^\/theaters\s*$/,
      handler: onTheaters
    },
    {
      matches: /^\/theaters (.+)/,
      handler: onTheatersForMovie
    },
    {
      matches: /^\/showtimes\s*/,
      handler: onShowtimesHelper
    }
  ]
}));
