import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {proxy} from '../proxy';
import {ACCESS_COOKIE_NAME,createAccessToken} from '../lib/access-auth';

test('protected Conveni endpoint requires application session and rejects cross-origin writes',async()=>{
 const oldPassword=process.env.APP_ACCESS_PASSWORD,oldSecret=process.env.APP_ACCESS_SESSION_SECRET;
 try{
  process.env.APP_ACCESS_PASSWORD='synthetic-password';process.env.APP_ACCESS_SESSION_SECRET='synthetic-session-secret';
  const url='https://fixture.example/api/records/00000000-0000-4000-8000-000000000001/conveni/economic';
  const anonymous=await proxy(new NextRequest(url));assert.equal(anonymous.status,307);assert.match(anonymous.headers.get('location')??'',/\/login/);
  const token=await createAccessToken('synthetic-session-secret');const cookie=`${ACCESS_COOKIE_NAME}=${token}`;
  const cross=await proxy(new NextRequest(url,{method:'POST',headers:{cookie,origin:'https://evil.example','sec-fetch-site':'cross-site'}}));assert.equal(cross.status,403);
  const trusted=await proxy(new NextRequest(url,{method:'POST',headers:{cookie,origin:'https://fixture.example','sec-fetch-site':'same-origin'}}));assert.equal(trusted.status,200);assert.equal(trusted.headers.get('x-middleware-next'),'1');
  delete process.env.APP_ACCESS_PASSWORD;const unconfigured=await proxy(new NextRequest(url,{headers:{cookie}}));assert.equal(unconfigured.status,307);
 }finally{if(oldPassword===undefined)delete process.env.APP_ACCESS_PASSWORD;else process.env.APP_ACCESS_PASSWORD=oldPassword;if(oldSecret===undefined)delete process.env.APP_ACCESS_SESSION_SECRET;else process.env.APP_ACCESS_SESSION_SECRET=oldSecret;}
});
