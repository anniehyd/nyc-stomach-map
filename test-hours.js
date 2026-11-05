// Quick test of the opening_hours parser without a browser.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
const start = src.indexOf('function parseHours'), end = src.indexOf('/* ---------- geo');
const code = src.slice(start, end) + "\nmodule.exports={parseHours,hoursStatus,hoursHuman};";
const prelude = "const DAYS=['Su','Mo','Tu','We','Th','Fr','Sa'];const DAY_ZH=['周日','周一','周二','周三','周四','周五','周六'];const SOON_MIN=45;function pad(n){return (n<10?'0':'')+n}function fmtMin(min){min=((min%1440)+1440)%1440;return pad(Math.floor(min/60))+':'+pad(min%60)}";
const m = {}; new Function('module', prelude + code)(m);
const { parseHours, hoursStatus, hoursHuman } = m.exports;
const cases = [
  ['Mo-Fr 08:00-22:00; Sa,Su 09:00-23:00', { day: 3, minutes: 21 * 60 + 30 }, 'open, soon'],
  ['Mo-Fr 08:00-22:00; Sa,Su 09:00-23:00', { day: 0, minutes: 8 * 60 }, 'closed, opens 09:00'],
  ['Mo-Su 10:00-02:00', { day: 2, minutes: 60 }, 'open (overnight spill), closes 02:00'],
  ['Mo-Su 10:00-02:00', { day: 2, minutes: 150 }, 'closed, opens 10:00'],
  ['24/7', { day: 5, minutes: 200 }, 'always'],
  ['Mo-Sa 07:00-20:00; Su off', { day: 0, minutes: 600 }, 'closed Sunday, opens Monday 07:00'],
  ['Mo-Th 11:00-15:00,17:00-22:00; Fr-Su 11:00-23:00', { day: 1, minutes: 16 * 60 }, 'closed, opens 17:00'],
  ['Mo-Su 06:00-24:00', { day: 1, minutes: 23 * 60 + 50 }, 'open till 00:00 soon'],
];
for (const [spec, t, want] of cases) {
  const p = parseHours(spec);
  console.log(JSON.stringify(spec).padEnd(52), '->', JSON.stringify(hoursStatus(p, t)), '   want:', want);
}
console.log(hoursHuman(parseHours('Mo-Fr 08:00-22:00; Sa,Su 09:00-23:00')));
