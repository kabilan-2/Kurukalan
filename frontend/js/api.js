const API = {
  async req(method, url, body){
    const opt = {method, credentials:'same-origin', headers:{}};
    if(body !== undefined){ opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    let r;
    try{ r = await fetch(url, opt); }catch(e){ const err = new Error('Cannot reach the server. Please start it with "npm start".'); err.network = true; throw err; }
    let data = null; try{ data = await r.json(); }catch(e){}
    if(!r.ok){ const err = new Error((data && data.error) || ('Error ' + r.status)); err.status = r.status; throw err; }
    return data;
  },
  get:   u    => API.req('GET', u),
  post:  (u,b) => API.req('POST', u, b || {}),
  patch: (u,b) => API.req('PATCH', u, b || {}),
  del:   u    => API.req('DELETE', u, {})
};
