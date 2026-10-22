const inferenceGuard = String.raw`
const remoteReference = value => Array.isArray(value) ? value.some(remoteReference) : value && typeof value === 'object' && (value.type === 'url' || Object.entries(value).some(([key,item]) => ((key === 'file_id' || key === 'file_url') && typeof item === 'string') || (['image_url','audio_url'].includes(key) && typeof item === 'string' && !item.startsWith('data:')) || remoteReference(item)));
const inferenceRequest = async (request, anthropic) => {
  const allowed = anthropic ? ['/v1/messages','/v1/messages/count_tokens'] : ['/v1/responses'];
  if (request.method !== 'POST' || !allowed.includes(request.url)) throw new Error('endpoint');
  let text = '';
  for await (const chunk of request) { text += chunk; if (text.length > 33554432) throw new Error('limit'); }
  const body = JSON.parse(text);
  if (body.mcp_servers || body.container || body.previous_response_id || body.conversation || body.prompt?.id || body.background || (body.tools ?? []).some(tool => tool.type && !['function','custom'].includes(tool.type)) || remoteReference(body.input ?? body.messages)) throw new Error('effect');
  if (!anthropic) body.store = false;
  return JSON.stringify(body);
};
`;

export const repairProgram =
  inferenceGuard +
  String.raw`
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as cp from 'node:child_process';
import * as crypto from 'node:crypto';
import * as readline from 'node:readline';

const input = JSON.parse(fs.readFileSync('/case/input.json', 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const prompt = fs.readFileSync('/data/prompt.md', 'utf8').replaceAll('{{ADHD}}', fs.existsSync('/data/adhd.md') ? fs.readFileSync('/data/adhd.md', 'utf8') : '');
const loaded = input.main && ['baseline','candidate'].includes(input.stage) ? { 'prompt.md': sha(fs.readFileSync('/data/prompt.md')), ...(fs.existsSync('/data/adhd.md') ? { 'adhd.md': sha(fs.readFileSync('/data/adhd.md')) } : {}) } : {};
const effects = [];
const unknown = [];
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) => [key,ordered(value)])) : value;
const effectUses = new Map();
const toolCatalog = [...new Map([{name:'read_skill',description:'Read a frozen replay skill.',inputSchema:{type:'object',properties:{name:{type:'string'}},required:['name']}}, ...input.tools.filter(tool => tool.name !== 'read_skill'), ...input.effects.map(effect => effect.tool)].map(tool => [tool.name,tool])).values()];
const server = http.createServer(async (request, response) => {
  if (request.url !== '/mcp') {
    let data;
    try { data = await inferenceRequest(request, input.driver !== 'codex'); }
    catch { response.writeHead(403); response.end(); return; }
    const upstream = http.request({socketPath:'/inference.sock',path:request.url,method:request.method,headers:{'content-type':'application/json'}}, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on('error', () => { response.writeHead(503); response.end(); });
    upstream.end(data);
    return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 1048576) throw new Error('request-limit');
    }
    const frame = JSON.parse(body);
    let result = {};
    if (frame.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Ozi replay', version: '1' } };
    if (frame.method === 'tools/list') result = { tools: toolCatalog };
    if (frame.method === 'tools/call') {
      const { name, arguments: args = {} } = frame.params;
      if (name === 'read_skill' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(args.name)) {
        const relative = 'skills/' + args.name + '/SKILL.md';
        const file = fs.realpathSync('/data/' + relative);
        if (!file.startsWith('/data/skills/')) throw new Error('skill-escape');
        const text = fs.readFileSync(file, 'utf8');
        loaded[relative] = sha(text);
        result = { content: [{type:'text',text}], structuredContent: {text} };
      } else {
        const key = name + JSON.stringify(ordered(args));
        const count = effectUses.get(key) ?? 0;
        const effect = input.effects.filter(effect => effect.tool.name === name && JSON.stringify(ordered(effect.arguments)) === JSON.stringify(ordered(args)))[count];
        effectUses.set(key,count + 1);
        effects.push({name, arguments:args, stubbed:Boolean(effect)});
        if (!effect) unknown.push(name);
        result = effect ? effect.result : { isError: true, content: [{type:'text',text:'Unknown replay effect.'}] };
      }
    }
    response.writeHead(200, {'content-type':'application/json'});
    response.end(JSON.stringify({jsonrpc:'2.0',id:frame.id,result}));
  } catch {
    unknown.push('invalid-effect');
    response.writeHead(400);
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const inference = 'http://127.0.0.1:' + server.address().port;
const endpoint = inference + '/mcp';
const transcript = [];
const pending = new Map();
let child;
let next = 0;
let done;
const completed = new Promise((resolve, reject) => { done = {resolve,reject}; });
const stage = input.stage;
const options = Object.fromEntries(input.options.map(option => [option.id,option.value]));
const replay = stage === 'baseline' || stage === 'candidate';
const system = replay ? (input.main ? prompt : input.workerPrompt) : stage === 'author' ? 'Repair only the candidate data root. Follow the correction ladder: types or structure, then checks, then prompt or skills. Protected files and the frozen case are immutable. Return JSON with changedPaths and evidence.' : 'Independently judge the frozen case and both transcripts. Return JSON with baselineReproduced, candidatePassed, agrees, evidence. Disagreement or uncertainty fails.';
const message = replay ? input.message : stage === 'author' ? '[OZI_REPAIR_AUTHOR]\n' + JSON.stringify(input.case) : '[OZI_REPAIR_OBSERVER]\n' + JSON.stringify(input.case);
const images = input.attachments.filter(attachment => attachment.type === 'image').map(attachment => ({type:'image',data:fs.readFileSync('/case/attachments/' + attachment.file).toString('base64'),mimeType:attachment.mimeType}));
const send = value => child.stdin.write(JSON.stringify(value) + '\n');
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = String(++next);
  pending.set(id, {resolve,reject});
  send(input.driver === 'pi' ? {id,type:method,...params} : {id,method,params});
});
const spawn = args => {
  child = cp.spawn(input.executable, args, {cwd:'/data', env:{...process.env,T3_MCP_URL:endpoint,OZI_REPAIR_STAGE:stage,ANTHROPIC_BASE_URL:inference,ANTHROPIC_API_KEY:'ozi-inference',OPENAI_BASE_URL:inference + '/v1',OPENAI_API_KEY:'ozi-inference'}, stdio:['pipe','pipe','pipe']});
  let stderr = '';
  child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-16384); });
  child.on('error', done.reject);
  child.on('exit', code => { if (code) done.reject(new Error('provider-exit-' + code + ':' + stderr)); });
  readline.createInterface({input:child.stdout}).on('line', line => {
    try {
      const frame = JSON.parse(line);
      if (pending.has(String(frame.id))) {
        const waiter = pending.get(String(frame.id));
        pending.delete(String(frame.id));
        if (frame.error || frame.success === false) waiter.reject(new Error('native-protocol'));
        else waiter.resolve(input.driver === 'pi' ? frame.data : frame.result);
      }
      if (input.driver === 'pi' && frame.type === 'message_end' && frame.message?.role === 'assistant') {
        if (frame.message.stopReason === 'error') done.reject(new Error('provider-error'));
        transcript.push(...(frame.message.content ?? []).filter(item => item.type === 'text').map(item => item.text));
      }
      if (input.driver === 'pi' && frame.type === 'agent_settled') done.resolve();
      if (frame.method === 'item/completed' && frame.params.item.type === 'agentMessage') transcript.push(frame.params.item.text);
      if (frame.method === 'turn/completed') frame.params.turn.status === 'completed' ? done.resolve() : done.reject(new Error('provider-error'));
      if (frame.type === 'assistant') transcript.push(...(frame.message.content ?? []).filter(item => item.type === 'text').map(item => item.text));
      if (frame.type === 'result') frame.is_error ? done.reject(new Error('provider-error')) : done.resolve();
    } catch (error) { done.reject(error); }
  });
};
try {
  if (input.driver === 'pi') {
    spawn(['--mode','rpc','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--extension','/launcher/extension.mjs','--system-prompt',system,...(replay || stage === 'observer' ? ['--no-tools'] : []),...(replay ? ['--fork','/case/session.jsonl'] : [])]);
    await rpc('get_state');
    await rpc('set_model',{provider:input.model.includes('/') ? input.model.split('/')[0] : 'anthropic',modelId:input.model.split('/').at(-1)});
    if (options.thinking) await rpc('set_thinking_level',{level:options.thinking});
    const state = await rpc('get_state');
    if (state.model.id !== input.model.split('/').at(-1) || (options.thinking && state.thinkingLevel !== options.thinking)) throw new Error('effective-loadout-mismatch');
    if (replay) {
      const entries = (await rpc('get_entries')).entries;
      const entry = entries.find(entry => entry.id === input.boundary);
      if (!entry) throw new Error('missing-native-boundary');
      const fork = await rpc('fork',{entryId:entry.id});
      if (fork.cancelled) throw new Error('native-fork-cancelled');
      const prefix = (await rpc('get_entries')).entries;
      if (prefix.some(entry => entry.id === input.boundary)) throw new Error('native-fork-boundary');
    }
    await rpc('prompt',{message,...(images.length ? {images} : {})});
  } else if (input.driver === 'codex') {
    if (replay) {
      fs.mkdirSync('/home/repair/codex/sessions', {recursive:true});
      fs.copyFileSync('/case/session.jsonl', '/home/repair/codex/' + input.nativeId + '.jsonl');
      fs.copyFileSync('/case/session.jsonl', '/home/repair/codex/sessions/rollout-' + input.nativeId + '.jsonl');
    }
    spawn(['app-server']);
    await rpc('initialize',{clientInfo:{name:'ozi-repair',version:'1'},capabilities:{}});
    send({method:'initialized',params:{}});
    const params = {model:input.model,cwd:'/data',approvalPolicy:'never',sandbox:'danger-full-access',baseInstructions:system,serviceTier:options.serviceTier,config:{'mcp_servers.t3-code':{url:endpoint}}};
    const session = await rpc(replay ? 'thread/fork' : 'thread/start', {...params,...(replay ? {threadId:input.nativeId,...(input.boundary ? {lastTurnId:input.boundary} : {})} : {})});
    if (replay && session.thread.id === input.nativeId) throw new Error('native-fork-not-isolated');
    await rpc('turn/start',{threadId:session.thread.id,input:[{type:'text',text:message},...input.attachments.filter(attachment => attachment.type === 'image').map(attachment => ({type:'localImage',path:'/case/attachments/' + attachment.file}))],effort:options.reasoningEffort,...params});
  } else {
    if (replay) {
      fs.mkdirSync('/home/repair/claude/projects/-data', {recursive:true});
      fs.copyFileSync('/case/session.jsonl', '/home/repair/claude/projects/-data/' + input.nativeId + '.jsonl');
    }
    spawn(['--print','--input-format','stream-json','--output-format','stream-json','--verbose','--dangerously-skip-permissions','--strict-mcp-config','--model',input.model,'--system-prompt',system,...(options.effort ? ['--effort',options.effort] : []),'--settings',JSON.stringify({...(typeof options.fastMode === 'boolean' ? {fastMode:options.fastMode} : {}),...(typeof options.thinking === 'boolean' ? {alwaysThinkingEnabled:options.thinking} : {})}),'--mcp-config',JSON.stringify({mcpServers:{'t3-code':{type:'http',url:endpoint}}}),...(replay ? ['--resume',input.nativeId,'--fork-session',...(input.boundary ? ['--resume-session-at',input.boundary] : [])] : [])]);
    send({type:'control_request',request_id:'init',request:{subtype:'initialize',hooks:{},systemPrompt:system}});
    send({type:'user',message:{role:'user',content:images.length ? [{type:'text',text:message},...images.map(image => ({type:'image',source:{type:'base64',media_type:image.mimeType,data:image.data}}))] : message},parent_tool_use_id:null,session_id:''});
  }
  await completed;
  process.stdout.write(JSON.stringify({transcript,effects,unknown,loadout:{provider:input.driver,model:input.model,systemPromptSha256:sha(system),loaded},nativeFork:replay,prefixSha256:sha(fs.readFileSync('/case/session.jsonl'))}) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({error:error.message,transcript,effects,unknown,loadout:{loaded}}) + '\n');
  process.exitCode = 1;
} finally {
  child?.kill('SIGTERM');
  server.close();
}
`;

export const inferenceProgram =
  inferenceGuard +
  String.raw`
import * as http from 'node:http';
import * as https from 'node:https';
const anthropic = process.env.OZI_INFERENCE_PROVIDER === 'anthropic';
const host = anthropic ? 'api.anthropic.com' : 'api.openai.com';
const server = http.createServer(async (request,response) => {
  let data;
  try { data = await inferenceRequest(request, anthropic); }
  catch { response.writeHead(403); response.end(); return; }
  const upstream = https.request({hostname:host,path:request.url,method:'POST',headers:{'content-type':'application/json',...(anthropic ? {'x-api-key':process.env.OZI_INFERENCE_KEY,'anthropic-version':'2023-06-01'} : {authorization:'Bearer ' + process.env.OZI_INFERENCE_KEY})}}, incoming => {
    response.writeHead(incoming.statusCode ?? 502, {'content-type':incoming.headers['content-type'] ?? 'application/json'});
    incoming.pipe(response);
  });
  upstream.on('error', () => { response.writeHead(502); response.end(); });
  upstream.end(data);
});
server.listen(process.argv[2], () => process.stdout.write('ready\n'));
`;

export const extensionProgram = String.raw`
import * as fs from 'node:fs';
export default function(pi) {
  const input = JSON.parse(fs.readFileSync('/case/input.json','utf8'));
  const tools = [...new Map([{name:'read_skill',description:'Read a data-root skill.',inputSchema:{type:'object',properties:{name:{type:'string'}},required:['name']}}, ...input.tools.filter(tool => tool.name !== 'read_skill'), ...input.effects.map(effect => effect.tool)].map(tool => [tool.name,tool])).values()];
  for (const tool of tools) pi.registerTool({
    name:tool.name,label:tool.name,description:tool.description,parameters:tool.inputSchema,
    async execute(_id,args) {
      const response = await fetch(process.env.T3_MCP_URL, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name:tool.name,arguments:args}})});
      return (await response.json()).result;
    }
  });
}
`;
