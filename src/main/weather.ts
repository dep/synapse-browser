import { net } from 'electron'
import type { WeatherInfo } from '../shared/ipc'

const TTL = 30 * 60_000
const NEG_TTL = 5 * 60_000 // failure back-off so a dead network isn't hammered
// countries reporting in Fahrenheit
const F_COUNTRIES = new Set(['US', 'BS', 'BZ', 'KY', 'PW'])

// IP geolocation → Open-Meteo current conditions. No API keys. Failures are
// swallowed: the new-tab page simply omits the weather line.
export class WeatherService {
  private value: WeatherInfo | null = null
  private fetchedAt = 0
  private failedAt = 0
  private inflight: Promise<WeatherInfo | null> | null = null

  cached(): WeatherInfo | null {
    return Date.now() - this.fetchedAt <= TTL ? this.value : null
  }

  async get(): Promise<WeatherInfo | null> {
    const cached = this.cached()
    if (cached) return cached
    if (Date.now() - this.failedAt <= NEG_TTL) return null
    this.inflight ??= this.fetch()
      .catch(() => null)
      .then((v) => {
        if (v) {
          this.value = v
          this.fetchedAt = Date.now()
        } else {
          this.failedAt = Date.now()
        }
        this.inflight = null
        return v
      })
    return this.inflight
  }

  private async fetch(): Promise<WeatherInfo | null> {
    const geoRes = await net.fetch(
      'http://ip-api.com/json/?fields=status,lat,lon,city,countryCode',
    )
    const geo = (await geoRes.json()) as {
      status?: string
      lat?: number
      lon?: number
      city?: string
      countryCode?: string
    }
    if (geo.status !== 'success' || typeof geo.lat !== 'number' || typeof geo.lon !== 'number')
      return null
    const wxRes = await net.fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current_weather=true`,
    )
    const wx = (await wxRes.json()) as {
      current_weather?: { temperature?: number; weathercode?: number }
    }
    const cw = wx.current_weather
    if (!cw || typeof cw.temperature !== 'number' || typeof cw.weathercode !== 'number')
      return null
    return {
      tempC: cw.temperature,
      code: cw.weathercode,
      city: geo.city ?? '',
      useFahrenheit: F_COUNTRIES.has(geo.countryCode ?? ''),
    }
  }
}
