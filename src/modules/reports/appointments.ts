import type { AppointmentClient, AppointmentItem } from '../appointments/domain';
import type { ReportDateRange } from './insights';

export type AppointmentReportInput = {
  clients: AppointmentClient[];
  appointments: AppointmentItem[];
  receipts: Array<{ payerRefType:string; payerRefId:string; amountPence:number; receivedAt:string; deletedAt?:string|null }>;
  expenses: Array<{ expenseDate:string; amountPence:number; deletedAt?:string|null }>;
  otherIncome: Array<{ incomeDate:string; amountPence:number; deletedAt?:string|null }>;
};

export type AppointmentWorkspaceReport = {
  completed: number;
  cancelled: number;
  scheduled: number;
  serviceMinutes: number;
  travelMinutes: number;
  workMinutes: number;
  earnedPence: number;
  receivedPence: number;
  expensesPence: number;
  otherIncomePence: number;
  netCashPence: number;
  duePence: number;
  effectiveHourlyPence: number;
  clientRows: Array<{ clientId:string; name:string; completed:number; minutes:number; receivedPence:number; duePence:number }>;
};

function sum(values:number[]):number{return values.reduce((total,value)=>total+Number(value||0),0);}

export function buildAppointmentReport(data:AppointmentReportInput,range:ReportDateRange):AppointmentWorkspaceReport{
  const inRange=(value:string)=>value.slice(0,10)>=range.fromDate&&value.slice(0,10)<=range.toDate;
  const rows=data.appointments.filter((row)=>!row.deletedAt&&inRange(row.appointmentDate));
  const completed=rows.filter((row)=>row.status==='completed');
  const cancelled=rows.filter((row)=>row.status==='cancelled'||row.status==='missed');
  const scheduled=rows.filter((row)=>row.status==='scheduled');
  const serviceMinutes=sum(completed.map((row)=>row.durationMinutes));
  const travelMinutes=sum(completed.map((row)=>row.travelMinutes));
  const workMinutes=serviceMinutes+travelMinutes;
  const earnedPence=sum(completed.map((row)=>row.pricePence));
  const activeReceipts=data.receipts.filter((row)=>!row.deletedAt&&row.payerRefType==='appointments.client');
  const receivedPence=sum(activeReceipts.filter((row)=>inRange(row.receivedAt)).map((row)=>row.amountPence));
  const expensesPence=sum(data.expenses.filter((row)=>!row.deletedAt&&inRange(row.expenseDate)).map((row)=>row.amountPence));
  const otherIncomePence=sum(data.otherIncome.filter((row)=>!row.deletedAt&&inRange(row.incomeDate)).map((row)=>row.amountPence));
  const netCashPence=receivedPence+otherIncomePence-expensesPence;
  const duePence=Math.max(0,earnedPence-receivedPence);
  const effectiveHourlyPence=workMinutes?Math.round((earnedPence*60)/workMinutes):0;
  const clientRows=data.clients.map((client)=>{
    const clientCompleted=completed.filter((row)=>row.clientId===client.id);
    const clientEarned=sum(clientCompleted.map((row)=>row.pricePence));
    const clientReceived=sum(activeReceipts.filter((row)=>row.payerRefId===client.id&&inRange(row.receivedAt)).map((row)=>row.amountPence));
    return {clientId:client.id,name:client.name,completed:clientCompleted.length,minutes:sum(clientCompleted.map((row)=>row.durationMinutes)),receivedPence:clientReceived,duePence:Math.max(0,clientEarned-clientReceived)};
  }).filter((row)=>row.completed||row.receivedPence||row.duePence).sort((a,b)=>b.completed-a.completed||a.name.localeCompare(b.name,'ar'));
  return {completed:completed.length,cancelled:cancelled.length,scheduled:scheduled.length,serviceMinutes,travelMinutes,workMinutes,earnedPence,receivedPence,expensesPence,otherIncomePence,netCashPence,duePence,effectiveHourlyPence,clientRows};
}
