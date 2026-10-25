export function validateProof(rows, now = new Date()) {
  const errors = [];
  if (!Array.isArray(rows) || !rows.length) return ['Proof must contain rows.'];
  for (const row of rows) {
    for (const key of ['id', 'claim', 'value', 'unit', 'measured_at', 'expires_at', 'command', 'package_version']) {
      if (row[key] === undefined || row[key] === null || row[key] === '') errors.push(`${row.id || 'row'}: missing ${key}`);
    }
    const measured = Date.parse(row.measured_at), expires = Date.parse(row.expires_at);
    if (!Number.isFinite(measured) || !Number.isFinite(expires)) errors.push(`${row.id}: invalid dates`);
    else {
      if (expires <= +now) errors.push(`${row.id}: expired`);
      if (expires - measured !== 90 * 86400000) errors.push(`${row.id}: expiry must be 90 days`);
      if (measured > +now) errors.push(`${row.id}: measured in the future`);
    }
  }
  return errors;
}
export function proofTable(rows) {
  return ['<!-- proof:start -->', '| Measurement | Value | Measured | Expires |', '|---|---|---|---|', ...rows.map(row => `| ${row.claim} | ${row.value} ${row.unit} | ${row.measured_at.slice(0, 10)} | ${row.expires_at.slice(0, 10)} |`), '<!-- proof:end -->'].join('\n');
}
