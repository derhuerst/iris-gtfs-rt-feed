import cleanStationNameBasic from 'db-clean-station-name'
import cleanStationNameWithLocation from 'db-clean-station-name/lib/with-location.js'

const normalizeStopName = (stopName, stop) => {
	const {latitude, longitude} = stop ?? {}
	if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
		const {
			full: fullName,
			short: shortName,
			// matchedLocationIds,
		} = cleanStationNameWithLocation(stopName, {longitude, latitude})
		return (shortName ?? fullName)?.toLowerCase()
	}
	return cleanStationNameBasic(stopName)?.toLowerCase()
}

export {
	normalizeStopName,
}
