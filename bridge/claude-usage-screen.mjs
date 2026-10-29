// Read only the built-in /usage pane. No prompt is sent to a model.
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function parseUsageScreen(screen, now = Date.now()) {
  const plain = screen.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const read = label => {
    const heading = new RegExp(label, 'i').exec(plain);
    if (!heading) return null;
    const block = plain.slice(heading.index + heading[0].length).split(/Current\s*(?:session|week)|What's\s*contributing/i)[0];
    const match = block.match(/([0-9]+(?:\.[0-9]+)?)%\s*used\s*Resets\s*([^\r\n]+?\([^)]*\))/i);
    if (!match || Number(match[1]) > 100) return null;
    return {used_percentage: Number(match[1]), resets_at: parseReset(match[2], now)};
  };
  const five_hour = read('Current\\s*session');
  const seven_day = read('Current\\s*week\\s*\\(all\\s*models\\)');
  return five_hour && seven_day ? {rate_limits: {five_hour, seven_day}} : null;
}
function parseReset(text, now) {
  // The probe explicitly uses Taipei time. Never guess an unrecognized format.
  const s = text.replace(/\s/g, '');
  const m = s.match(/^(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{1,2})at)?(\d{1,2})(?::(\d{2}))?(am|pm)\(Asia\/Taipei\)$/i);
  if (!m) return null;
  let hour = Number(m[3]);
  if (hour < 1 || hour > 12 || Number(m[4] || 0) > 59) return null;
  hour = hour % 12 + (m[5].toLowerCase() === 'pm' ? 12 : 0);
  const local = new Date(now + 8 * 3600000);
  let year = local.getUTCFullYear();
  const month = m[1] ? months.findIndex(x => x.toLowerCase() === m[1].toLowerCase()) : local.getUTCMonth();
  const day = m[2] ? Number(m[2]) : local.getUTCDate();
  let reset = Date.UTC(year, month, day, hour - 8, Number(m[4] || 0));
  if (reset < now - 60000) reset = m[1] ? Date.UTC(++year, month, day, hour - 8, Number(m[4] || 0)) : reset + 86400000;
  if (reset - now > (m[1] ? 8 * 86400000 : 5 * 3600000) || reset < now - 60000) return null;
  return reset / 1000;
}
