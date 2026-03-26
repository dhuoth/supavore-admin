const ADMIN_TIME_ZONE = 'America/Los_Angeles';

const adminDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: ADMIN_TIME_ZONE,
});

const adminTimeZoneFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ADMIN_TIME_ZONE,
  timeZoneName: 'short',
});

export function formatAdminTimestamp(value: string) {
  const date = new Date(value);
  const formattedDateTime = adminDateTimeFormatter.format(date);
  const timeZoneName = adminTimeZoneFormatter
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')
    ?.value;

  return timeZoneName ? `${formattedDateTime} ${timeZoneName}` : formattedDateTime;
}
