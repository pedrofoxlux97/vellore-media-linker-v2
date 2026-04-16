# Vellore Media Linker V2

Versão 2 forte, sem dependências externas, pronta para rodar com `node server.js` ou `npm start`.

## O que esta versão entrega
- Dashboard com totais e uploads recentes
- Criação de pastas
- Upload de arquivos com validação
- Geração automática de links públicos
- Listagem de arquivos com busca e filtro
- Preview de imagem, vídeo, PDF e HTML
- Renomear arquivo
- Excluir arquivo
- Auditoria básica
- Configuração por `.env`
- Compatível com publicação via IIS ou Nginx

## Tipos permitidos
- `.mp4`
- `.jpg`
- `.jpeg`
- `.png`
- `.pdf`
- `.html`

## Como rodar
### 1. Instale Node.js
No Windows, instale a versão LTS.

### 2. Extraia a pasta do projeto

### 3. Configure o `.env`
Copie `.env.example` para `.env` e ajuste se precisar.

Exemplo local:
```env
PORT=3001
PUBLIC_BASE_URL=http://localhost:3001
PUBLIC_FILES_PATH=/arquivos
MAX_UPLOAD_MB=200
```

Exemplo Windows com pasta publicada:
```env
PORT=3001
PUBLIC_BASE_URL=https://midia.suaempresa.com
PUBLIC_FILES_PATH=/arquivos
MAX_UPLOAD_MB=200
STORAGE_ROOT=C:\midia\arquivos
```

### 4. Rodar
```bash
npm start
```

ou

```bash
node server.js
```

Abra:
```text
http://localhost:3001
```

## Estrutura
```text
vellore-media-linker-v2/
├─ public/
├─ data/
├─ storage/
│  └─ arquivos/
├─ .env.example
├─ package.json
├─ README.md
└─ server.js
```

## Subindo via IIS no Windows
### Aplicação
- deixe o Node rodando localmente em `localhost:3001`
- publique um site no IIS apontando para um domínio
- use ARR + URL Rewrite para fazer proxy reverso para `http://127.0.0.1:3001`

### Arquivos públicos
Crie a pasta:
```text
C:\midia\arquivos
```

No IIS, publique `/arquivos` como diretório virtual apontando para essa pasta.

### Link gerado
Com:
```env
PUBLIC_BASE_URL=https://midia.suaempresa.com
PUBLIC_FILES_PATH=/arquivos
STORAGE_ROOT=C:\midia\arquivos
```

um arquivo salvo em:
```text
C:\midia\arquivos\rh\comunicados\video.mp4
```

vira:
```text
https://midia.suaempresa.com/arquivos/rh/comunicados/video.mp4
```

## Subindo via Nginx
- app em `localhost:3001`
- Nginx fazendo proxy para a aplicação
- Nginx servindo a pasta `/arquivos`

## Endpoints úteis
- `GET /api/health`
- `GET /api/config`
- `GET /api/dashboard`
- `GET /api/folders`
- `POST /api/folders`
- `GET /api/files`
- `POST /api/files/upload`
- `PATCH /api/files/:id`
- `DELETE /api/files/:id`
- `GET /api/audit`

## Observações importantes
- Esta versão usa JSON local como banco para simplificar deploy e homologação.
- A aplicação já foi desenhada para deploy atrás de IIS ou Nginx.
- Para produção mais pesada, o próximo passo é trocar JSON por SQLite ou PostgreSQL e rodar o processo Node como serviço.


## Correção V2.1
- URLs públicas antigas gravadas no banco agora são recalculadas automaticamente com base nas variáveis atuais do ambiente.
