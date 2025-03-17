// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module'
const require = createRequire(import.meta.url)

const stations = require('./stada.json')

const stationNamesByEvaNr = new Map()
stations.result.forEach(s => 
	s.evaNumbers.forEach(e => 
		stationNamesByEvaNr.set(e.number.toString(), [s.name, s.ifopt])
	)
);

export {
	stations,
	stationNamesByEvaNr,
}
