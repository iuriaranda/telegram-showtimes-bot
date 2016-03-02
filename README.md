telegram-showtimes-bot
======================

I'm a telegram bot to search movie showtimes and theaters near a predefined location. You can chat with me [here](https://telegram.me/showtimesbot).

## What can I do?

I can show you nearby theaters and showtimes. Just start by letting me know where you are with the /setlocation command, and then I will be able to send you movies (/movies) and theaters (/theaters) screening near you.

## Commands

### /setlocation [location]

Sets the location specified in the text. `location` can be a city and country names, a postal code, or latitude and longitude (separated by ,).

##### Responses:
 - Your location has been successfully set to __your location__
 - There has been an error setting your location, please try again later

### location message sent

Sets the user's location using the coordinates specified in the location message.

##### Responses:
 - Your location has been successfully set to __your location__
 - There has been an error setting your location, please try again later

### /movies or /showtimes [query]

Shows movie showtimes and nearby theaters screening them. You can filter the movies and dates with `query`, for example `/movies tomorrow` will show showtimes for tomorrow, and `/movies star wars` will only show showtimes for movies containing star wars in their title.

##### Responses:
- Here are the showtimes for __today__ in __location__:
- There has been an error retrieving showtimes, please try again later

### /theaters [query]

Shows nearby theaters and the movies they are screening. You can filter the theaters and dates with `query`, for example `/theaters tomorrow` will show theaters and their showtimes for tomorrow, and `/theaters Verdi` will only show nearby theaters called Verdi.

##### Responses:
- Here are the theaters screening __today__ in __location__:
- There has been an error retrieving showtimes, please try again later

## License

MIT
