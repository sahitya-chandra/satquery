import assert from 'node:assert/strict';
import { writeFile, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = process.env.SATQUERY_TEST_URL || 'http://localhost:3000';
const debug = process.env.SATQUERY_BROWSER_DEBUG_URL || 'http://127.0.0.1:9227';
const artifacts = await mkdtemp(join(tmpdir(), 'satquery-browser-'));
const pages = await (await fetch(debug + '/json')).json();
const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, {once:true}));
let id = 0; const pending = new Map();
ws.addEventListener('message', event => { const m=JSON.parse(event.data); if(m.id){ const p=pending.get(m.id); pending.delete(m.id); if(m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); } });
function send(method, params={}) { return new Promise((resolve,reject)=>{ const n=++id; pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params})); }); }
async function evaluate(expression) { const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value; }
async function waitFor(expression) { for(let i=0;i<120;i++){if(await evaluate(`Boolean(${expression})`))return;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out: '+expression); }
await send('Page.enable');
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
const {identifier:fixtureId}=await send('Page.addScriptToEvaluateOnNewDocument',{source:`
const originalFetch = window.fetch.bind(window);
window.__submitted = [];
window.__delay = 300;
window.fetch = async (url, options) => {
 if (!String(url).endsWith('/api/analyze')) return originalFetch(url,options);
 window.__submitted.push(Object.fromEntries([...options.body].map(([k,v])=>[k,v instanceof File?v.name:v])));
 await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,window.__delay);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));},{once:true});});
 const result={task:'visual_question',answer:'Browser fixture: water is visible.',reason:'Visual question.',model:'test:vision',observations:[{image:1,description:'Water near the centre.'}],limitations:['Test fixture'],clarification:'',all_warnings:[]};
 return Response.json({ok:true,error:null,errors:[],result,visuals:[{id:'image-1',label:'Image 1',src:'/demo_data/single_optical.png'}],input_metadata:[],trace:[],report:JSON.stringify(result)});
};`});
async function clickText(text, selector='button') {
 const expression=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
 await waitFor(expression);
 if(selector==='button'){await evaluate(`${expression}.click()`);return;}
 const rect=await evaluate(`(()=>{const el=${expression};el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});
}
async function shot(name) {const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,name+'.png'),Buffer.from(shot.data,'base64'));}
async function query(text) {await evaluate(`(()=>{const t=document.querySelector('#query');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function upload(selector,path){await waitFor(`document.querySelector(${JSON.stringify(selector)})`);const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector});await send('DOM.setFileInputFiles',{nodeId,files:[path]});}
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:base});
await waitFor(`document.querySelector('[data-testid=connection-status]')?.textContent.includes('AI connected')`);
await shot('desktop-empty');
assert.equal(await evaluate(`document.querySelector('[data-testid=analyze]').disabled`),true);
assert.equal(await evaluate(`document.querySelectorAll('input[type=file]').length`),1);
const demo=fileURLToPath(new URL('../public/demo_data/', import.meta.url));
await upload('input[type=file]',demo+'single_optical.png');
await clickText('Add a second image');
await upload('input[aria-label="Choose image 2"]',demo+'change_after.png');
await waitFor(`document.querySelectorAll('[data-testid=upload-grid] img').length===2`);
await clickText('Let AI choose','[role=combobox]');
await clickText('Explore one image','[role=option]');
await waitFor(`document.querySelectorAll('input[type=file]').length===1`);
await query('Describe this scene');
await evaluate(`document.querySelector('[data-testid=analyze]').click()`);
await waitFor(`document.querySelector('[data-testid=analysis-result]')`);
assert.equal(await evaluate(`window.__submitted.at(-1).second_image`),undefined);
assert.equal(await evaluate(`window.__submitted.at(-1).first_image`),'single_optical.png');
assert.equal(await evaluate(`document.querySelector('[data-testid=analysis-result]').textContent.includes('test:vision')`),true);
await evaluate(`document.querySelector('[data-testid=analysis-result]').scrollIntoView({block:'start'})`);
await shot('desktop-result');
await evaluate(`document.querySelector('button[aria-label^=Enlarge]').click()`);
await waitFor(`document.querySelector('[role=dialog]')`);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await waitFor(`!document.querySelector('[role=dialog]')`);
await query('Describe the water');
await waitFor(`!document.querySelector('[data-testid=analysis-result]')`);
await clickText('Try an example','[role=tab]');
await evaluate(`document.querySelector('[data-example=change]').click()`);
await waitFor(`document.querySelector('#analysis-mode').textContent.includes('Compare two dates')`);
await evaluate(`document.querySelector('[data-testid=analyze]').click()`);
await waitFor(`document.querySelector('[data-testid=analysis-result]')`);
assert.equal(await evaluate(`window.__submitted.at(-1).first_image`),undefined);
assert.equal(await evaluate(`window.__submitted.at(-1).second_image`),undefined);
await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:artifacts});
await evaluate(`document.querySelector('[data-testid=download-report]').click()`);
for(let i=0;i<30;i++){if((await readdir(artifacts)).includes('satquery_ai_report.json'))break;await new Promise(r=>setTimeout(r,100));}
const report=JSON.parse(await readFile(join(artifacts,'satquery_ai_report.json'),'utf8'));
assert.equal(report.model,'test:vision');
await evaluate(`window.__delay=5000;document.querySelector('[data-testid=analyze]').click()`);
await waitFor(`document.querySelector('[data-testid=cancel-analysis]')`);
assert.equal(await evaluate(`document.querySelector('#query').matches(':disabled')`),true);
await evaluate(`document.querySelector('[data-testid=cancel-analysis]').click()`);
await waitFor(`document.querySelector('[data-testid=analysis-error]')?.textContent.includes('cancelled')`);
assert.ok(await evaluate(`document.querySelector('#query').value.length>0`));
await clickText('New analysis');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await evaluate(`window.scrollTo(0,0)`);
await shot('mobile-empty');
assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),true);
const invalid=join(artifacts,'invalid.pdf');await writeFile(invalid,'invalid');
await upload('input[type=file]',invalid);
await waitFor(`document.querySelector('[data-testid=input-error]')`);
assert.equal(await evaluate(`document.querySelector('[data-testid=analyze]').disabled`),true);
await clickText('Try an example','[role=tab]');
await evaluate(`document.querySelector('[data-example=single]').click();window.__delay=300;document.querySelector('[data-testid=analyze]').click()`);
await waitFor(`document.querySelector('[data-testid=analysis-result]')`);
assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),true);
await evaluate(`document.querySelector('[data-testid=analysis-result]').scrollIntoView({block:'start'})`);
await shot('mobile-result');
console.log('PASS: upload previews, mode switching, stale result clearing, example isolation, report export, cancellation, invalid files, mobile overflow. Model responses stubbed.');
await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:fixtureId});
await send('Page.navigate',{url:'about:blank'});
ws.close();
console.log('Artifacts:', artifacts);
