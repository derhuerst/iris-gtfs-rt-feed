import cleanDbStationName from 'db-clean-station-name'
import cleanDbStationNameUsingLocation from 'db-clean-station-name/lib/with-location.js'
import normalizeForSearch from 'normalize-for-search'

const _cleanStationName = (name, location) => {
	if (location) {
		const cleaned = cleanDbStationNameUsingLocation(name, {
			latitude: location.latitude,
			longitude: location.longitude,
		})
		if (cleaned?.short) {
			return cleaned.short
		}
	}
	return cleanDbStationName(name)
}
const normalizeStationName = (name, location = null) => {
	const cleanedName = _cleanStationName(name, location)
	return normalizeForSearch(cleanedName)
}

export {
	normalizeStationName,
}
