
let zeroPattern = /^(Z|([+-]00)|([+-]00:?00))$/

import { getTimezoneOffset } from "date-fns-tz";

export default function validate(timeZoneString: string) {
    if (zeroPattern.test(timeZoneString)) {
        return true;
    }
    const tzOffset = getTimezoneOffset(timeZoneString);
    if (tzOffset) {
        return true;
    } else {
        try {
            Intl.DateTimeFormat(undefined, { timeZone: timeZoneString })
            return true;
        } catch {
            return false;
        }
    }
}
