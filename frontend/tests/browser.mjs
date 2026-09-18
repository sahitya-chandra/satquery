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
await send('Page.navigate',{url:base});
await waitFor(`document.querySelector('.primary-action') && !document.querySelector('.primary-action').disabled`);
assert.equal(await evaluate(`document.querySelectorAll('input[type=checkbox]').length`),0);
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Upload').click()`);
await waitFor(`document.querySelectorAll('input[type=file]').length===2`);
async function upload(selector,path){const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector});await send('DOM.setFileInputFiles',{nodeId,files:[path]});}
const demo=fileURLToPath(new URL('../public/demo_data/', import.meta.url));
await upload('input[type=file]',demo+'single_optical.png');
await upload('.file-drop:nth-child(2) input',demo+'change_after.png');
await waitFor(`document.querySelectorAll('.preview-grid img[src^="data:"]').length===2`);
await evaluate(`document.querySelector('#analysis-mode').value='Single Image';document.querySelector('#analysis-mode').dispatchEvent(new Event('change',{bubbles:true}))`);
await waitFor(`document.querySelectorAll('input[type=file]').length===1 && document.querySelectorAll('.preview-grid img').length===1`);
await evaluate(`document.querySelector('.primary-action').click()`);
await waitFor(`document.querySelector('.result-stack')`);
assert.equal(await evaluate(`window.__submitted.at(-1).second_image`),undefined);
assert.equal(await evaluate(`window.__submitted.at(-1).first_image`),'single_optical.png');
assert.equal(await evaluate(`document.querySelector('.metric-strip').textContent.includes('test:vision')`),true);
assert.equal(await evaluate(`document.querySelector('.metric-strip').textContent.includes('%')`),false);
await evaluate(`const t=document.querySelector('#query');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Describe the water');t.dispatchEvent(new Event('input',{bubbles:true}));`);
await waitFor(`!document.querySelector('.result-stack')`);
await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Demo').click()`);
await evaluate(`document.querySelector('.primary-action').click()`);
await waitFor(`document.querySelector('.result-stack')`);
assert.equal(await evaluate(`window.__submitted.at(-1).first_image`),undefined);
await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:artifacts});
await evaluate(`document.querySelector('.footer-actions button').click()`);
for(let i=0;i<30;i++){if((await readdir(artifacts)).includes('satquery_ai_report.json'))break;await new Promise(r=>setTimeout(r,100));}
const report=JSON.parse(await readFile(join(artifacts,'satquery_ai_report.json'),'utf8'));
assert.equal(report.model,'test:vision');
await evaluate(`window.__delay=5000;document.querySelector('.primary-action').click()`);
await waitFor(`document.querySelector('.cancel-action')`);
assert.equal(await evaluate(`document.querySelector('#query').matches(':disabled')`),true);
await evaluate(`document.querySelector('.cancel-action').click()`);
await waitFor(`document.querySelector('.error-band')?.textContent.includes('cancelled')`);
const screenshot=await send('Page.captureScreenshot',{format:'png'});
await writeFile(join(artifacts,'browser.png'),Buffer.from(screenshot.data,'base64'));
console.log('PASS: uploads/previews, single-image mode, no stale results, demo isolation, model result display, report download, cancellation. Browser responses stubbed; provider integration tested separately.');
await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:fixtureId});
await send('Page.navigate',{url:'about:blank'});
ws.close();
console.log('Artifacts:', artifacts);
