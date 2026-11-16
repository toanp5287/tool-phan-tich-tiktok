import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { datasetDb, datasetPool } from '../dist/config/datasetDb.js';
const server=createApp().listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const get=async path=>{const r=await fetch(base+'/api'+path);assert.equal(r.status,200,path);return (await r.json()).data;};
const product=(await get('/products?pageSize=1'))[0];
const shop=(await get('/shops?pageSize=1'))[0];
const creator=(await get('/creators?pageSize=1'))[0];
const category=(await get('/categories')).categories.find(x=>x.hasData);
const sub=category.subCategories[0];
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000}});
let blockedExternal=0,staticAssets=0;
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.origin===base)return route.continue();
 // Existing public UI libraries only; block provider APIs, media and tracking.
 if(url.href==='https://unpkg.com/vue@3.5.13/dist/vue.global.prod.js'||url.href==='https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js'){staticAssets++;return route.continue();}
 blockedExternal++;return route.abort();
});
const pages=['/app/','/app/overview','/app/products','/app/shops','/app/creators','/app/markets','/app/trends','/app/market-gap','/app/does-not-exist','/app/?view=products','/shop.html','/detail.html?id='+product.id,'/shops.html','/shop-detail.html?id='+shop.id,'/creators.html','/creator.html?id='+creator.id,'/categories.html','/category.html?name='+encodeURIComponent(category.name),...(sub?['/subcategory.html?category='+encodeURIComponent(category.name)+'&name='+encodeURIComponent(sub.name)]:[]),'/trends.html','/trend-analysis.html','/price-segments.html','/jobs.html','/targets.html','/ai-analysis.html'];
const results=[];
try {
 for(const path of pages){
  const page=await context.newPage();const errors=[],apiErrors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.url().startsWith(base+'/api/')&&r.status()>=400)apiErrors.push({url:r.url(),status:r.status()});});
  await page.goto(base+path,{waitUntil:'networkidle',timeout:45000});
  await page.waitForTimeout(500);
   const state=await page.evaluate(()=>({vue:!!window.Vue,unmounted:document.querySelectorAll('[v-cloak]').length,text:document.body.innerText.slice(0,180),bodyLength:document.body.innerText.length,charts:window.Chart?Object.values(window.Chart.instances).map(c=>({labels:c.data.labels.length,points:c.data.datasets.reduce((n,d)=>n+d.data.length,0)})):[],badNumbers:/NaN|Infinity/.test(document.body.innerText),kinds:[...document.querySelectorAll('.data-kind')].map(e=>e.textContent.trim())}));
   assert.equal(state.badNumbers,false,path+' invalid numeric display');
    if(path.startsWith('/app')) {assert.equal(await page.locator('.sidebar').count(),0,`${path} must not render a vertical sidebar`);assert.ok(await page.locator('.top-navigation').count(),`${path} must render top navigation`);}
    if(path==='/app/'||path==='/app/overview') {assert.ok(state.kinds.includes('Chưa xác định'),'Missing history must be labeled');assert.ok(await page.getByText('Chưa có chuỗi GMV theo ngày.',{exact:false}).count(),'Overview must explain missing commerce history');}
    if(path==='/app/does-not-exist') assert.ok(await page.getByText('Không tìm thấy màn hình này').count(),'Unknown workspace route must render Not Found state');
    if(path==='/app/market-gap') {
      assert.equal(apiErrors.filter(error=>error.url.includes('/ai-analyses')).length,0,'Opening Market Gap must not call AI');
      await page.locator('.market-filter select').first().selectOption({index:1});
      await page.locator('.market-filter form, form.market-filter').count();
      await page.getByRole('button',{name:'Tìm khoảng trống'}).click();
      await page.waitForSelector('.market-row, .empty');
      if(await page.locator('.market-row').count()) { await page.locator('.market-row').first().click(); await page.waitForSelector('.market-ai-report, .market-gap-page .stat-grid'); assert.ok(await page.getByRole('button',{name:'Phân tích chuyên sâu bằng AI'}).count(),'Market Gap detail must retain explicit AI action'); }
    }
   if(path==='/app/?view=products'||path==='/app/products'){
     await page.locator('table.data tbody tr').first().click();
     await page.waitForSelector('.drawer .data-kind');
     assert.ok(await page.locator('.drawer canvas, .drawer .empty').count(),'Drawer must render a history chart or explicit empty state');
     assert.ok(await page.getByRole('button',{name:'Phân tích AI'}).count(),'Product detail must retain explicit AI action');
    assert.equal(errors.length,0,'Drawer runtime errors');
   }
  results.push({path,errors,apiErrors,...state});
  await page.close();
 }
 console.log(JSON.stringify({results,staticAssets,blockedExternal}));
 assert.ok(results.every(r=>r.vue),'Vue library must load');
 assert.ok(results.every(r=>r.errors.length===0),'Browser runtime errors');
 assert.ok(results.every(r=>r.apiErrors.length===0),'API integration errors');
 assert.ok(results.every(r=>r.unmounted===0),'Unrendered Vue view');
 assert.ok(results.every(r=>r.bodyLength>100),'Blank rendered page');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));await datasetDb.$disconnect();await datasetPool.end();}
