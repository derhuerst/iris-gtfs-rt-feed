import {IANAZone} from 'luxon'

// selected from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects#error_objects
const PROGRAMMER_ERRORS = [
	RangeError,
	ReferenceError,
	SyntaxError,
	TypeError,
	URIError,
]
const isProgrammerError = (err) => {
	// todo: use `PROGRAMMER_ERRORS.includes(err.__proto__.constructor)`?
	return PROGRAMMER_ERRORS.some(Err => err instanceof Err)
}

const dbTimezone = new IANAZone('Europe/Berlin')

const kNormalizedStopName = Symbol('GTFS Schedule normalized_stop_name')
const kStopLatitude = Symbol('stop latitude')
const kStopLongitude = Symbol('stop longitude')

export {
	PROGRAMMER_ERRORS,
	isProgrammerError,
	dbTimezone,
	kNormalizedStopName,
	kStopLatitude,
	kStopLongitude,
}
