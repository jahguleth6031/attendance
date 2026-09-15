const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync(require('path').join(__dirname,'index.html'),'utf8');
function context(){
 const nodes=new Map(),alerts=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',style:{},className:'',innerHTML:'',textContent:'',addEventListener(){},querySelectorAll(){return[];},classList:{toggle(){}},appendChild(){},remove(){},click(){}});return nodes.get(id);};
 let authHandler;
 const fakeAuth={GoogleAuthProvider:function(){}};
 function firestore(){return {};}
 firestore.FieldValue={serverTimestamp:()=>({server:true})};
 const s={console,Date,Math,JSON,Number,String,Object,Array,Set,Promise,RegExp,Error,Blob,URL,crypto:require('crypto').webcrypto,setTimeout,clearTimeout,confirm:()=>true,alert:x=>alerts.push(x),firebase:{initializeApp(){},firestore,auth:Object.assign(()=>({onAuthStateChanged(fn){authHandler=fn;},signOut:async()=>{}}),fakeAuth)},document:{getElementById:node,querySelectorAll:()=>[],addEventListener(){},createElement:()=>node('temp'),body:{appendChild(){}}},window:{addEventListener(){},print(){}}};
 s.window.window=s.window;vm.createContext(s);
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())vm.runInContext(match[1],s);
 return {s,node,alerts,getAuthHandler:()=>authHandler};
}
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
const {s,node}=context();
const standard={stdAmIn:'08:00',stdAmOut:'12:00',stdPmIn:'13:00',stdPmOut:'17:00',otRate:100};
test('half-hour rate: 2h is 400',()=>assert.equal(s.calcOT({status:'full',amIn:'07:30',amOut:'12:30',pmIn:'13:00',pmOut:'18:00'},standard).totalPay,400));
test('one minute rounds to one half-hour',()=>assert.equal(s.calcOT({status:'am',amIn:'07:59',amOut:'12:00'},standard).totalPay,100));
test('normal schedule has zero overtime',()=>assert.equal(s.calcOT({status:'full',amIn:'08:00',amOut:'12:00',pmIn:'13:00',pmOut:'17:00'},standard).totalPay,0));
test('labor 40100 matches item totals, disaster once',()=>{const c=s.calcLabor(40100);assert.equal(c.emp,1002);assert.equal(c.employer,3569);assert.equal(c.employer,c.accidentEmployer+c.employmentEmployer+c.disasterAmt);});
test('health 45800 remains 710',()=>assert.equal(s.calcHealth(45800,0).emp,710));
test('record reads do not create absent days',()=>{s.records={};s.getRecord('2026-09-01',0);assert.equal(Object.keys(s.records).length,0);});
test('time edits reject overlapping shifts',()=>assert.throws(()=>s.validateTimeRecord({status:'full',amIn:'08:00',amOut:'14:00',pmIn:'13:00',pmOut:'17:00'})));
test('HTML escapes names/notes safely',()=>assert.equal(s.escapeHTML('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;'));
test('invalid backup rejected before data replacement',()=>{s.employees=['safe'];assert.throws(()=>s.applyData({employees:'bad'}));assert.equal(s.employees[0],'safe');assert.throws(()=>s.validateBackup(JSON.parse('{"employees":[],"records":{"__proto__":{}}}')));});
test('legacy backup gets stable ids and split migrations',()=>{s.applyData({employees:['A','B'],salarySettings:{0:{base:30000}},records:{'2026-09-01':{0:{present:true,in:'08:00',out:'12:00'}}}});assert.equal(s.employeeIds.length,2);assert.notEqual(s.employeeIds[0],s.employeeIds[1]);assert.equal(s.records['2026-09-01'][0].status,'full');});
test('deletion remaps every indexed collection and keeps snapshots',()=>{
 s.employees=['A','B','C'];s.employeeIds=['idA','idB','idC'];s.salarySettings={0:{base:1},1:{base:2},2:{base:3}};s.insuranceSettings={2:{laborSalary:45800}};s.records={'2026-09-01':{2:{status:'full'}}};s.changeItems={items:[{amounts:{2:88}}]};s.payrollHistory=[{leaveAdj:{2:{overDays:2}},pays:[{employeeId:'idB',name:'B',netPay:200}]}];
 s.remapAllEmployeeData([0,2]);assert.equal(s.employees[1],'C');assert.equal(s.employeeIds[1],'idC');assert.equal(s.salarySettings[1].base,3);assert.equal(s.records['2026-09-01'][1].status,'full');assert.equal(s.changeItems.items[0].amounts[1],88);assert.equal(s.payrollHistory[0].pays[0].employeeId,'idB');
});
test('saved history remains unchanged after salary change',()=>{s.employees=['A'];s.employeeIds=['idA'];const h={pays:[{employeeId:'idA',netPay:9000}]};s.salarySettings={0:{base:999999}};assert.equal(s.historyPayFor(h,0).netPay,9000);assert.equal(s.historyPayFor({},0),null);});
test('leave adjustment refunds previously over-deducted money',()=>{
 s.employees=['A'];s.salarySettings={0:s.migrateSalary({type:'monthly',dailyWage:1000,monthlyLeaveDays:4})};s.records={};for(let i=1;i<=20;i++)s.records['2026-09-'+String(i).padStart(2,'0')]={0:{status:i<=5?'absent':'full'}};
 s.payrollHistory=[{start:'2026-09-01',end:'2026-09-10',leaveAdj:{0:{overAmt:2000,overDays:2}}}];const a=s.calcLeaveAdj(0,'2026-09-11','2026-09-20');assert.equal(a.underAmt,1000);assert.equal(a.netAmount,-1000);assert.equal(a.refund,true);
});
test('zero allowed leave still deducts',()=>{s.salarySettings[0].monthlyLeaveDays=0;s.payrollHistory=[];assert.equal(s.calcLeaveAdj(0,'2026-09-01','2026-09-20').overAmt,5000);});
test('month boundaries include leap February',()=>{assert.equal(s.isLastDayOfMonth('2028-02-29'),true);assert.equal(s.isLastDayOfMonth('2028-02-28'),false);});
test('overlap rejected before payroll save',()=>{s.payrollHistory=[{start:'2026-09-01',end:'2026-09-10'}];assert.throws(()=>s.validatePayroll('2026-09-05','2026-09-15'),/重疊/);});
test('cross-month payroll rejected instead of wrong leave calculation',()=>assert.throws(()=>s.validatePayroll('2026-08-21','2026-09-10'),/跨月/));
test('cost uses stored net total instead of current settings',()=>{node('costYear').value='2026';s.payrollHistory=[{start:'2026-09-01',end:'2026-09-10',date:'2026-09-10',total:9123}];s.renderCostReport();assert.match(node('costReport').innerHTML,/9,123/);});
test('malformed times rejected',()=>{assert.equal(s.toMin('25:30'),null);assert.equal(s.toMin('09:99'),null);assert.equal(s.toMin('09:30'),570);});
async function syncTests(){
 const {s:x,node:n}=context();x.applyData({employees:['A']});x.currentUser={uid:'test'};x.dataReady=true;x.loadedRevision='r1';x.getDocRef=()=>({});
 let stored={revision:'r1'},writes=0;
 vm.runInContext('db.runTransaction=async function(fn){return fn(testTransaction);}',Object.assign(x,{testTransaction:{get:async()=>({exists:true,data:()=>stored}),set:(ref,d)=>{stored=d;writes++;}}}));
 x.saveData();await x.flushSave();assert.equal(writes,1);assert.equal(x.pendingSave,false);passed++;console.log('PASS transaction saves and confirms actual cloud result');
 stored={revision:'other-device'};x.saveData();await assert.rejects(x.flushSave(),/其他裝置/);assert.equal(writes,1);assert.equal(x.pendingSave,true);passed++;console.log('PASS concurrent device write rejected without overwrite');clearTimeout(x.saveTimer);
 const {s:y}=context();y.currentUser={uid:'test'};y.dataReady=true;y.getDocRef=()=>({get:async()=>{throw Error('network');}});await y.loadData();assert.equal(y.dataReady,false);passed++;console.log('PASS failed load leaves writes disabled');
 const {s:z}=context();z.currentUser={uid:'A'};z.dataReady=true;let resolve;z.getDocRef=()=>({get:()=>new Promise(r=>resolve=r)});const promise=z.loadData();z.sessionEpoch++;z.currentUser={uid:'B'};z.resetAppData();resolve({exists:true,data:()=>({employees:['private A']})});await promise;assert.equal(z.employees.length,0);passed++;console.log('PASS stale account read cannot populate next session');
 console.log('TOTAL '+passed+' tests passed');
}
syncTests().catch(e=>{console.error(e);process.exitCode=1;});
