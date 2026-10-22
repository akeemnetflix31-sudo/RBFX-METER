const dailyCounts = new Map();

export function dateKeyInKualaLumpur(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export async function recordAnonymousFormatCheck(now = new Date()) {
  const key = dateKeyInKualaLumpur(now);
  dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
  return dailyCounts.get(key);
}

export async function summarizeAnonymousFormatChecks(_store, now = new Date()) {
  const today = dateKeyInKualaLumpur(now);
  const todayStart = new Date(`${today}T00:00:00+08:00`).getTime();
  const daily = Array.from({ length: 30 }, (_, index) => {
    const date = dateKeyInKualaLumpur(new Date(todayStart - (29 - index) * 86400000));
    return { date, count: dailyCounts.get(date) || 0 };
  });
  return { date: today, todayFormatChecks: dailyCounts.get(today) || 0, totalFormatChecks: [...dailyCounts.values()].reduce((sum, count) => sum + count, 0), daysWithChecks: dailyCounts.size, cacheMode: 'IN_MEMORY_EPHEMERAL', cacheScope: 'THIS_WARM_VERCEL_INSTANCE_ONLY', daily };
}

export async function readAnonymousFormatSummary(now = new Date()) {
  return summarizeAnonymousFormatChecks(null, now);
}
