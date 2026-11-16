import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
const log=await open('backups/dataset-server.log','a');
const child=spawn(process.execPath,['dist/server.js'],{detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,SCRAPE_SCHEDULER_ENABLED:'false',SCRAPE_ON_STARTUP:'false',SCRAPE_SHOP_ON_STARTUP:'false',SCRAPE_AUTO_START_LOOP:'false',ECHOTIK_ENABLED:'false',GEMINI_ENABLED:'false'}});
child.unref();await log.close();console.log(JSON.stringify({pid:child.pid,host:'127.0.0.1',mode:'DATASET_V2_LOCAL_REVIEW'}));
