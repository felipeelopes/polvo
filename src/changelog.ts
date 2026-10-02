// Novidades de cada versão, em todos os idiomas, mostradas uma vez depois de
// atualizar o Polvo. O CHANGELOG.md (notas da release) segue o texto em pt.
import type { Locale } from "./i18n";

export interface ReleaseNotes {
  version: string;
  notes: Record<Locale, string[]>;
}

export const RELEASES: ReleaseNotes[] = [
  {
    version: "0.2.0",
    notes: {
      pt: [
        "**Gerenciador de Git** integrado: alterações, diff com seleção de linhas, commit, branches, histórico, stash, pull requests e conflitos. Abra com `Ctrl+Shift+G` ou pelo ícone de branch na barra de título, em cada sessão e na barra lateral.",
        "**Os agentes ajudam no Git**: mensagem de commit gerada pelo Claude, revisão das alterações, resolução de conflitos e explicação de commits.",
        "**Nova branch numa worktree** com uma sessão do agente já aberta nela, para vários agentes trabalharem no mesmo repositório sem conflito.",
        "**Stash fácil**: guarde tudo ou um arquivo só, veja o conteúdo e restaure com um clique.",
        "**Selos de Git** na barra lateral e na barra de título: arquivos alterados, commits para enviar e para puxar.",
        "**Polvo animado** na marca e interface mais alinhada.",
      ],
      en: [
        "**Built-in Git manager**: changes, diff with line selection, commit, branches, history, stash, pull requests and conflicts. Open it with `Ctrl+Shift+G` or the branch icon in the title bar, on each session and in the sidebar.",
        "**Agents help with Git**: commit messages written by Claude, change reviews, conflict resolution and commit explanations.",
        "**New branch in a worktree** with an agent session already open in it, so several agents can work on the same repository without clashing.",
        "**Easy stash**: stash everything or a single file, preview it and restore with one click.",
        "**Git badges** in the sidebar and title bar: changed files, commits to push and to pull.",
        "**Animated Polvo** in the logo and a more aligned interface.",
      ],
      es: [
        "**Gestor de Git** integrado: cambios, diff con selección de líneas, commit, ramas, historial, stash, pull requests y conflictos. Ábrelo con `Ctrl+Shift+G` o con el icono de rama en la barra de título, en cada sesión y en la barra lateral.",
        "**Los agentes ayudan con Git**: mensajes de commit escritos por Claude, revisión de cambios, resolución de conflictos y explicación de commits.",
        "**Nueva rama en un worktree** con una sesión del agente ya abierta, para que varios agentes trabajen en el mismo repositorio sin chocar.",
        "**Stash fácil**: guarda todo o un solo archivo, mira el contenido y restáuralo con un clic.",
        "**Indicadores de Git** en la barra lateral y la barra de título: archivos cambiados, commits por enviar y por traer.",
        "**Polvo animado** en el logo e interfaz mejor alineada.",
      ],
      fr: [
        "**Gestionnaire Git** intégré : modifications, diff avec sélection de lignes, commit, branches, historique, stash, pull requests et conflits. Ouvrez-le avec `Ctrl+Shift+G` ou l’icône de branche dans la barre de titre, sur chaque session et dans la barre latérale.",
        "**Les agents aident avec Git** : messages de commit rédigés par Claude, revue des modifications, résolution des conflits et explication des commits.",
        "**Nouvelle branche dans un worktree** avec une session d’agent déjà ouverte, pour que plusieurs agents travaillent sur le même dépôt sans se gêner.",
        "**Stash facile** : mettez tout ou un seul fichier de côté, consultez le contenu et restaurez en un clic.",
        "**Badges Git** dans la barre latérale et la barre de titre : fichiers modifiés, commits à pousser et à tirer.",
        "**Polvo animé** dans le logo et interface mieux alignée.",
      ],
      de: [
        "**Integrierte Git-Verwaltung**: Änderungen, Diff mit Zeilenauswahl, Commit, Branches, Verlauf, Stash, Pull Requests und Konflikte. Öffnen mit `Strg+Umschalt+G` oder über das Branch-Symbol in der Titelleiste, an jeder Sitzung und in der Seitenleiste.",
        "**Agenten helfen bei Git**: Commit-Nachrichten von Claude, Review der Änderungen, Konfliktlösung und Erklärung von Commits.",
        "**Neuer Branch in einem Worktree** mit bereits geöffneter Agenten-Sitzung, damit mehrere Agenten ohne Konflikte im selben Repository arbeiten.",
        "**Einfacher Stash**: alles oder nur eine Datei stashen, Inhalt ansehen und mit einem Klick wiederherstellen.",
        "**Git-Badges** in Seitenleiste und Titelleiste: geänderte Dateien, Commits zum Pushen und Pullen.",
        "**Animierter Polvo** im Logo und sauber ausgerichtete Oberfläche.",
      ],
      it: [
        "**Gestore Git** integrato: modifiche, diff con selezione delle righe, commit, branch, cronologia, stash, pull request e conflitti. Aprilo con `Ctrl+Shift+G` o con l’icona del branch nella barra del titolo, in ogni sessione e nella barra laterale.",
        "**Gli agenti aiutano con Git**: messaggi di commit scritti da Claude, revisione delle modifiche, risoluzione dei conflitti e spiegazione dei commit.",
        "**Nuovo branch in un worktree** con una sessione dell’agente già aperta, così più agenti lavorano sullo stesso repository senza conflitti.",
        "**Stash semplice**: salva tutto o un solo file, guardane il contenuto e ripristinalo con un clic.",
        "**Indicatori Git** nella barra laterale e nella barra del titolo: file modificati, commit da inviare e da scaricare.",
        "**Polvo animato** nel logo e interfaccia più allineata.",
      ],
      ja: [
        "**Git マネージャーを内蔵**: 変更、行単位で選べる差分、コミット、ブランチ、履歴、スタッシュ、プルリクエスト、コンフリクト。`Ctrl+Shift+G`、またはタイトルバー・各セッション・サイドバーのブランチアイコンから開けます。",
        "**エージェントが Git を手伝います**: Claude によるコミットメッセージ作成、変更のレビュー、コンフリクト解決、コミットの説明。",
        "**ワークツリーに新しいブランチ**を作り、エージェントのセッションをそのまま開始。複数のエージェントが同じリポジトリで衝突せずに作業できます。",
        "**かんたんスタッシュ**: すべて、またはファイル 1 つだけを退避し、内容を確認してワンクリックで復元。",
        "**Git バッジ**をサイドバーとタイトルバーに表示: 変更ファイル、プッシュ・プル待ちのコミット。",
        "ロゴの**ポルボがアニメーション**し、画面の配置も整いました。",
      ],
      zh: [
        "**内置 Git 管理器**：更改、可按行选择的差异、提交、分支、历史、储藏、拉取请求和冲突。用 `Ctrl+Shift+G` 打开，或点击标题栏、每个会话和侧边栏中的分支图标。",
        "**智能体协助 Git**：由 Claude 撰写提交说明、审查更改、解决冲突并解释提交。",
        "**在工作树中新建分支**，并直接打开智能体会话，让多个智能体在同一仓库中互不干扰地工作。",
        "**轻松储藏**：储藏全部或单个文件，预览内容，一键恢复。",
        "**Git 徽标**显示在侧边栏和标题栏：已更改的文件、待推送和待拉取的提交。",
        "标志中的 **Polvo 会动了**，界面也更加整齐。",
      ],
      ko: [
        "**내장 Git 관리자**: 변경 사항, 줄 단위 선택이 되는 diff, 커밋, 브랜치, 기록, 스태시, 풀 리퀘스트, 충돌. `Ctrl+Shift+G` 또는 제목 표시줄·각 세션·사이드바의 브랜치 아이콘으로 엽니다.",
        "**에이전트가 Git을 도와줍니다**: Claude가 쓰는 커밋 메시지, 변경 사항 리뷰, 충돌 해결, 커밋 설명.",
        "**워크트리에 새 브랜치**를 만들고 에이전트 세션을 바로 열어, 여러 에이전트가 같은 저장소에서 충돌 없이 작업합니다.",
        "**쉬운 스태시**: 전체 또는 파일 하나만 보관하고, 내용을 미리 보고, 클릭 한 번으로 복원합니다.",
        "사이드바와 제목 표시줄의 **Git 배지**: 변경된 파일, 푸시·풀할 커밋.",
        "로고의 **Polvo 애니메이션**과 더 깔끔하게 정렬된 인터페이스.",
      ],
      ru: [
        "**Встроенный менеджер Git**: изменения, diff с выбором строк, коммиты, ветки, история, stash, pull request и конфликты. Открывается через `Ctrl+Shift+G` или значок ветки в заголовке окна, у каждой сессии и в боковой панели.",
        "**Агенты помогают с Git**: сообщения коммитов от Claude, ревью изменений, разрешение конфликтов и объяснение коммитов.",
        "**Новая ветка в worktree** сразу с открытой сессией агента — несколько агентов работают в одном репозитории без конфликтов.",
        "**Простой stash**: спрячьте всё или один файл, посмотрите содержимое и восстановите в один клик.",
        "**Значки Git** в боковой панели и заголовке: изменённые файлы, коммиты для отправки и получения.",
        "**Анимированный Polvo** в логотипе и более ровный интерфейс.",
      ],
    },
  },
];

/** Compara versões "a.b.c". */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
