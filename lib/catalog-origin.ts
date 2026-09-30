export function safeCatalogOrigin(value:unknown) {
 if(typeof value!=='string'||value.length>1500||!value.startsWith('/')||value.startsWith('//'))return '/catalog';
 const url=new URL(value,'http://local.invalid');
 return url.origin==='http://local.invalid'&&(/^\/(catalog|approved|review|analysis)(\/|$)/.test(url.pathname)||/^\/records\/[\da-f-]+$/.test(url.pathname)||/^\/batches\/[\da-f-]+\/results$/.test(url.pathname))?url.pathname+url.search:'/catalog';
}
