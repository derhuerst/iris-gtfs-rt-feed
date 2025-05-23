// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module'
const require = createRequire(import.meta.url)

const stations = require('./stations.json')

const stationsByEvaNr = new Map()
for (const station of stations) {
	stationsByEvaNr.set(station.evaNr, station)
}

export {
	stations,
	stationsByEvaNr,
}
