/* ============================================================
   測試模式後端（只在 config.js 的 DEMO_MODE 為 true 時啟用）
   用瀏覽器 localStorage 模擬 Supabase：登入、權限、ID、平衡分派、進度、後台。
   資料只存在這台電腦的這個瀏覽器，不會上傳任何地方。
   正式上線前請把 config.js 的 DEMO_MODE 改成 false。
   ============================================================ */
(function(){
  const APP = window.APP_CONFIG || {};
  if(!APP.DEMO_MODE) return;
  APP.SUPABASE_URL = 'https://demo.local'; APP.SUPABASE_ANON_KEY = 'demo';

  const DBK='exp_platform_demo_db'; let SK='exp_platform_demo_session';
  const RES = { email:'demo@demo.com', password:'demo1234', id:'researcher-1' };
  const rnd4 = () => Math.random().toString(16).slice(2,6).toUpperCase();
  const blank = (n,pre) => ({ pid: pre + String(n).padStart(4,'0') + '-' + rnd4(), auth_uid:null, grp:null, gap:null, nudge:null,
    step:'login', dwell_arrival:null, dwell_decision:null, created_at:new Date().toISOString(), claimed_at:null, completed_at:null });
  function seed(){ const d={rows:[],logs:[],seq:0,logSeq:0}; for(let i=0;i<8;i++) d.rows.push(blank(++d.seq,'TEST')); save(d); return d; }
  const save = d => localStorage.setItem(DBK, JSON.stringify(d));
  const load = () => { try{ const d=JSON.parse(localStorage.getItem(DBK)); if(d&&d.rows){ d.logs=d.logs||[]; d.logSeq=d.logSeq||0; return d; } }catch(e){} return seed(); };
  const getSess = () => { try{ return JSON.parse(localStorage.getItem(SK)); }catch(e){ return null; } };
  const setSess = s => s ? localStorage.setItem(SK, JSON.stringify(s)) : localStorage.removeItem(SK);
  const uid = () => (getSess()||{user:{}}).user.id;
  const isRes = () => { const s=getSess(); return !!s && !s.user.is_anonymous && s.user.id===RES.id; };
  const E = m => ({ data:null, error:{ message:m } });
  const strip = r => { const c={...r}; delete c.auth_uid; return c; };
  const addLog = (db,actor_role,event_type,participant_pid,details) => db.logs.push({
    id:++db.logSeq, actor_uid:uid()||null, actor_role, event_type,
    participant_pid:participant_pid||null, details:details||{}, created_at:new Date().toISOString()
  });

  const rpc = {
    claim_participant({p_pid}){
      if(!uid()) return E('not_authenticated');
      if(isRes()) return E('researcher_cannot_participate');
      const db=load(), r=db.rows.find(x=>x.pid===String(p_pid).trim().toUpperCase());
      if(!r) return E('invalid_id');
      if(r.completed_at) return E('already_completed');
      db.rows.forEach(x=>{ if(x.auth_uid===uid() && x.pid!==r.pid) x.auth_uid=null; });
      const first=!r.grp;
      if(first){
        const cnt={A:0,B:0,C:0,D:0}; db.rows.forEach(x=>{ if(x.grp) cnt[x.grp]++; });
        const min=Math.min(...Object.values(cnt)); const pool=Object.keys(cnt).filter(k=>cnt[k]===min);
        const g=pool[Math.floor(Math.random()*pool.length)];
        Object.assign(r,{ grp:g, gap:'AB'.includes(g)?'low':'high', nudge:'BD'.includes(g)?'green':'none', step:'intro', claimed_at:new Date().toISOString() });
      }
      r.auth_uid=uid();
      addLog(db,'participant',first?'participant_claimed':'participant_resumed',r.pid,{group:r.grp,step:r.step});
      save(db); return { data:strip(r), error:null };
    },
    get_my_participant(){
      const rows=load().rows.filter(x=>x.auth_uid===uid()).sort((a,b)=>String(b.claimed_at).localeCompare(String(a.claimed_at)));
      return { data: rows[0]?strip(rows[0]):null, error:null };
    },
    update_progress({p_step,p_dwell_arrival,p_dwell_decision}){
      const db=load(), r=db.rows.find(x=>x.auth_uid===uid() && !x.completed_at);
      if(r){ const previous_step=r.step; r.step=p_step; if(p_dwell_arrival!=null) r.dwell_arrival=p_dwell_arrival; if(p_dwell_decision!=null) r.dwell_decision=p_dwell_decision;
        if(p_step==='done') r.completed_at=new Date().toISOString();
        addLog(db,'participant',p_step==='done'?'participant_completed':'step_changed',r.pid,{previous_step,step:p_step,dwell_arrival:r.dwell_arrival,dwell_decision:r.dwell_decision});
        save(db); }
      return { data:null, error:null };
    },
    create_ids({n,prefix}){
      if(!isRes()) return E('forbidden');
      if(!(n>=1&&n<=1000)) return E('n_out_of_range');
      const db=load(), pre=String(prefix||'P').replace(/[^A-Za-z0-9]/g,'').toUpperCase(), out=[];
      for(let i=0;i<n;i++){ const r=blank(++db.seq,pre); db.rows.push(r); out.push(r.pid); }
      addLog(db,'researcher','ids_created',null,{count:n,prefix:pre}); save(db); return { data:out, error:null };
    },
    delete_unclaimed_participant({p_pid}){
      if(!isRes()) return E('forbidden');
      const db=load(), pid=String(p_pid||'').trim().toUpperCase(), r=db.rows.find(x=>x.pid===pid && !x.claimed_at);
      if(!r) return E('not_found_or_already_used');
      db.rows=db.rows.filter(x=>x!==r); addLog(db,'researcher','id_deleted',pid,{}); save(db);
      return { data:null, error:null };
    },
    log_researcher_event({p_event_type,p_details}){
      if(!isRes()) return E('forbidden');
      if(!['researcher_login','researcher_logout','participants_csv_exported'].includes(p_event_type)) return E('bad_event_type');
      const db=load(); addLog(db,'researcher',p_event_type,null,p_details||{}); save(db);
      return { data:null, error:null };
    }
  };

  function from(t){
    const st={op:'select',f:[],from:0,to:null};
    const run = async () => {
      const db=load();
      if(t==='profiles'){ const s=getSess(); return { data: (s&&s.user.id===RES.id)?[{role:'researcher'}]:[], error:null }; }
      if(t==='activity_logs'){
        if(!isRes()) return { data:null, error:{message:'permission denied'} };
        let logs=[...db.logs].reverse().filter(r=>st.f.every(([c,v])=>r[c]===v));
        if(st.to!=null) logs=logs.slice(st.from,st.to+1);
        return { data:logs, error:null };
      }
      let rows = isRes() ? db.rows : db.rows.filter(x=>x.auth_uid===uid());
      rows = rows.filter(r=>st.f.every(([c,v])=>r[c]===v));
      if(st.op==='delete'){
        if(!isRes()) return { data:null, error:{message:'permission denied'} };
        const ids=new Set(rows.filter(r=>!r.claimed_at).map(r=>r.pid));
        db.rows=db.rows.filter(r=>!ids.has(r.pid)); save(db); return { data:null, error:null };
      }
      return { data: rows.map(strip).sort((a,b)=>a.pid.localeCompare(b.pid)), error:null };
    };
    const q={ select(){return q}, eq(c,v){ st.f.push([c==='user_id'?'__none__':c,v]); if(c==='user_id') st.f.pop(); return q}, order(){return q},
      delete(){ st.op='delete'; return q }, range(from,to){ st.from=from||0; st.to=to; return run() },
      maybeSingle(){ return run().then(r=>({data:(r.data||[])[0]||null,error:r.error})) },
      then(a,b){ return run().then(a,b) } };
    return q;
  }

  window.supabase = { createClient: () => ({
    auth:{
      getSession: async () => ({ data:{ session:getSess() } }),
      signInAnonymously: async () => { setSess({ user:{ id:'anon-'+Math.random().toString(36).slice(2,10), is_anonymous:true } }); return { data:{}, error:null }; },
      signInWithPassword: async ({email,password}) => {
        if(email===RES.email && password===RES.password){ setSess({ user:{ id:RES.id, email:RES.email, is_anonymous:false } }); return { error:null }; }
        return { error:{ message:'Invalid login credentials' } };
      },
      signOut: async () => { setSess(null); }
    },
    rpc: async (fn,args) => rpc[fn] ? rpc[fn](args||{}) : E('unknown_function'),
    from
  }) };

  // 研究者後台與填答頁各自使用獨立的登入狀態（和正式版相同），互不登出
  const _cc = window.supabase.createClient;
  window.supabase.createClient = (u,k,opts) => { const sk = opts && opts.auth && opts.auth.storageKey; if(sk) SK = 'exp_demo_session_' + sk; return _cc(u,k,opts); };

  document.addEventListener('DOMContentLoaded', () => {
    const b=document.createElement('div');
    b.setAttribute('role','note');
    b.style.cssText='background:#FFF1D6;color:#5C3D00;font:13px/1.5 system-ui,sans-serif;padding:8px 16px;text-align:center;border-bottom:1px solid #E5CD96';
    b.innerHTML='<b>測試模式</b>：資料只存在這個瀏覽器，不會上傳。研究者帳號 <b>demo@demo.com</b> / <b>demo1234</b>；內建測試 ID 可在後台查看。 <button id="demoReset" style="font:inherit;margin-left:8px">清除測試資料</button>';
    document.body.insertBefore(b, document.body.firstChild);
    document.getElementById('demoReset').onclick=()=>{ if(confirm('清除所有測試資料與登入狀態？')){ Object.keys(localStorage).filter(k=>k===DBK||k.startsWith('exp_demo_session_')||k==='exp_platform_demo_session').forEach(k=>localStorage.removeItem(k)); location.reload(); } };
  });
})();

