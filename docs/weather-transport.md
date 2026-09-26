# Weather provider

Weather requests use the Render backend -> WeatherAPI HTTPS forecast endpoint. Set `WEATHER_API_KEY` only in the backend environment. The backend sends the key only to WeatherAPI, rejects redirects, and never includes the key in frontend configuration, response JSON, or logs. Missing or invalid configuration returns `UNAVAILABLE`. Weather does not use Apps Script or Open-Meteo.

The backend requests two forecast days for the parcel or point coordinates and limits current and hourly fields to those needed for current Celsius temperature, observation time, and next-hour rain probability. It selects the first forecast hour strictly after the location's current time using WeatherAPI epoch timestamps, then formats forecast and observation times for Asia/Bangkok. The existing frontend weather result shape is unchanged: `status` (`AVAILABLE`, `UNAVAILABLE`, or `OUTSIDE_SERVICE_AREA`), `temperatureC`, `nextHourPrecipitationProbabilityPercent`, `nextHourForecastAt`, `updatedAt`, and `source` (`WeatherAPI`). The Phayao service-area check remains server-side.

Only successful `AVAILABLE` results are cached for 60 minutes. Same-location requests share an in-flight request, and the cache remains bounded. HTTP 429 applies a bounded cooldown using `Retry-After` when available. Other provider failures return `UNAVAILABLE` with only safe diagnostic stages/status codes in backend logs; raw provider responses and request URLs are not logged.

Google Apps Script remains a separate signed backend bridge for Google Drive parcel image upload, read, and delete. Its Drive settings and behavior are not part of weather configuration.
