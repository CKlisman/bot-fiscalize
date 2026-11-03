const button=document.getElementById('capture');
button.addEventListener('click',async()=>{
 button.disabled=true;const status=document.getElementById('status');status.textContent='Capturando conteúdo...';
 try{const result=await module.exports.captureTicketContent({timeoutMs:5000});
 document.getElementById('result').srcdoc='<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:16px;color:#18283f}td,th{padding:8px;border:1px solid #ccc}table{border-collapse:collapse}</style>'+result.contentHtml;
 document.getElementById('metadata').textContent=JSON.stringify({imageCount:result.imageCount,captureVersion:result.captureVersion},null,2);
 status.textContent='Captura concluída: descrição, histórico e tabela preservados.';
 }catch(error){status.textContent='Falha: '+error.message;}finally{button.disabled=false;}
});
