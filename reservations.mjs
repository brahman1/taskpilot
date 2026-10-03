export function reservations(tasks){return tasks.filter(t=>['pending','confirmed'].includes(t.status)||t.cancelledLocally).sort((a,b)=>(a.date+'T'+a.time).localeCompare(b.date+'T'+b.time));}
export function reservationDay(tasks,date){const day=tasks.filter(t=>t.date===date);return {pending:day.filter(t=>t.status==='pending'),confirmed:day.filter(t=>t.status==='confirmed')};}
