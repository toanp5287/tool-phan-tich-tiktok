import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createApp } from '../dist/app.js';
import { datasetDb as db, datasetPool as pool } from '../dist/config/datasetDb.js';

const target=await db.productCategory.findFirst({where:{isPrimary:true,verificationStatus:'VERIFIED',product:{market:'VN',currency:'VND'}},select:{categoryId:true}});
if(!target)throw Error('Missing verified VND category fixture');
const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch();
try{
 const page=await browser.newPage();const outside=[];page.on('request',request=>{if(!request.url().startsWith(origin))outside.push(request.url());});
 await page.goto(origin+'/market-intelligence.html',{waitUntil:'networkidle'});
 await page.locator('select').nth(0).selectOption(String(target.categoryId));
 await page.getByRole('button',{name:'TÌM KHOẢNG TRỐNG',exact:true}).click();
  await page.getByRole('heading',{name:'Danh sách ngách thị trường',exact:true}).waitFor();
  await page.locator('tbody tr').first().click();
  await page.getByRole('heading',{name:/Chi tiết ngách:/}).waitFor();
  const text=await page.locator('body').innerText();
  assert.ok(text.includes('Điểm cơ hội'));
  assert.ok(text.includes('Điểm cơ hội sơ bộ'));
  assert.ok(text.includes('Mức phân tích'));
  assert.ok(text.includes('Thiếu lịch sử'));
  assert.ok(text.includes('Độ tin cậy'));
 assert.deepEqual(outside,[]);
 console.log(JSON.stringify({result:'PASS',externalBrowserRequests:outside.length}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await db.$disconnect();await pool.end();}
