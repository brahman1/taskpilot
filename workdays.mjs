export const weekDays=Object.freeze([{value:1,label:'Lundi'},{value:2,label:'Mardi'},{value:3,label:'Mercredi'},{value:4,label:'Jeudi'},{value:5,label:'Vendredi'},{value:6,label:'Samedi'},{value:7,label:'Dimanche'}]);
export const defaultWorkDays=Object.freeze([1,2,3,4,5,6,7]);
export function validateWorkDays(days){if(!Array.isArray(days)||days.some(day=>!Number.isInteger(day)||day<1||day>7)||new Set(days).size!==days.length)throw Error('Choisissez les jours travaillés avec les cases prévues.');return days;}
export function workingDays(p){return validateWorkDays(p.workDays===undefined?defaultWorkDays:p.workDays);}
export function weekdayForDate(date){if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Date de planning invalide.');const d=new Date(date+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)throw Error('Date de planning invalide.');return d.getUTCDay()||7;}
export function isWorkingDate(date,p){return workingDays(p).includes(weekdayForDate(date));}
export function workDaysLabel(p){const selected=workingDays(p);return selected.length===7?'Tous les jours':selected.length?weekDays.filter(day=>selected.includes(day.value)).map(day=>day.label).join(', '):'Aucun jour travaillé';}
