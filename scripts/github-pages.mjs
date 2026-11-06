import { spawnSync } from 'node:child_process';

// Uses the owner's existing Git credential helper. Credentials stay in process memory.
// This file never writes tokens or prints credential-helper output.
const repository = process.argv[2] || 'robdojo88science/oweme.v1';
const action = process.argv[3] || 'status';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Provide owner/repository.');
const result = spawnSync('git', ['credential', 'fill'], {
  input: `protocol=https\nhost=github.com\npath=${repository}.git\n\n`, encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
});
const credential = Object.fromEntries((result.stdout || '').split('\n').filter(line => line.includes('=')).map(line => { const i=line.indexOf('='); return [line.slice(0,i),line.slice(i+1).trim()]; }));
if (!credential.password) throw new Error('No existing GitHub authorization is available. Sign in with Git Credential Manager, then retry.');
async function api(route, options={}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${route}`, {
    ...options,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${credential.password}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...options.headers },
  });
  let data={}; try { data=await response.json(); } catch { /* 204 has no body */ }
  return { status: response.status, data };
}
if(action==='enable') {
  const page=await api('/pages');
  if(page.status===404){const created=await api('/pages',{method:'POST',body:JSON.stringify({build_type:'workflow'})});if(created.status!==201)throw new Error(`Pages setup returned ${created.status}: ${created.data.message||'Not created'}`);process.stdout.write(JSON.stringify({status:created.status,url:created.data.html_url})+'\n');}
  else if(page.status===200){if(page.data.build_type!=='workflow'){const updated=await api('/pages',{method:'PUT',body:JSON.stringify({build_type:'workflow'})});if(updated.status!==204)throw new Error(`Pages configuration returned ${updated.status}`);}process.stdout.write(JSON.stringify({status:200,url:page.data.html_url})+'\n');}
  else throw new Error(`Pages status returned ${page.status}: ${page.data.message||'Unavailable'}`);
}else if(action==='runs'){
  const runs=await api('/actions/runs?per_page=3');if(runs.status!==200)throw new Error(`Actions returned ${runs.status}`);process.stdout.write(JSON.stringify(runs.data.workflow_runs?.map(run=>({id:run.id,status:run.status,conclusion:run.conclusion,url:run.html_url,sha:run.head_sha})))+'\n');
}else if(action==='dispatch'){
  const dispatched=await api('/actions/workflows/deploy.yml/dispatches',{method:'POST',body:JSON.stringify({ref:'main'})});if(dispatched.status!==204)throw new Error(`Workflow dispatch returned ${dispatched.status}: ${dispatched.data.message||'Unavailable'}`);process.stdout.write('Workflow dispatched.\n');
}else{
  const repo=await api('');const page=await api('/pages');process.stdout.write(JSON.stringify({repository:repo.data.full_name,defaultBranch:repo.data.default_branch,canPush:repo.data.permissions?.push,pagesStatus:page.status,url:page.data.html_url})+'\n');
}
