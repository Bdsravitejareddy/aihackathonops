'use strict';

function normalizeDatabaseUrl(value) {
  const url = new URL(value);
  if (['prefer', 'require', 'verify-ca'].includes(url.searchParams.get('sslmode'))) url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

module.exports = { normalizeDatabaseUrl };
