import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPrivateAddress,fetchWithLimits} from '../lib/pipeline/document-input';
test('document downloads block loopback, mapped hexadecimal IPv4 and private transitions',()=>{for(const ip of ['127.0.0.1','10.2.3.4','169.254.169.254','100.64.0.1','::1','::ffff:7f00:1','::ffff:127.0.0.1','2002:7f00:1::','fc00::1'])assert.equal(isPrivateAddress(ip),true,ip);assert.equal(isPrivateAddress('8.8.8.8'),false);assert.equal(isPrivateAddress('2606:4700:4700::1111'),false);});
test('nonpublic and unapproved document targets fail before network requests',async()=>{await assert.rejects(fetchWithLimits('http://127.0.0.1:55421'),/privada/);await assert.rejects(fetchWithLimits('https://example.org',{allowedHosts:['contractaciopublica.cat']}),/Domini/);await assert.rejects(fetchWithLimits('file:///etc/passwd'),/Protocol/);});
