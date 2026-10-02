// Novidades de cada versão, em todos os idiomas, mostradas uma vez depois de
// atualizar o Polvo. O CHANGELOG.md (notas da release) segue o texto em pt.
import type { Locale } from "./i18n";

export interface ReleaseNotes {
  version: string;
  notes: Record<Locale, string[]>;
}

export const RELEASES: ReleaseNotes[] = [
  {
    version: "0.3.2",
    notes: {
      pt: ["**Meu trabalho com os estados reais do Azure DevOps**: work items mostram o estado e o tipo como no Boards (Committed, Approved, Product Backlog Item…), com as cores de lá. Filtros, pendentes, grupos e sprint seguem a categoria oficial de cada estado, inclusive em processos customizados."],
      en: ["**My work with real Azure DevOps states**: work items show their state and type as in Boards (Committed, Approved, Product Backlog Item…), in Boards colors. Filters, pending items, groups and the sprint follow each state's official category, including in custom processes."],
      es: ["**Mi trabajo con los estados reales de Azure DevOps**: los work items muestran el estado y el tipo como en Boards (Committed, Approved, Product Backlog Item…), con sus colores. Filtros, pendientes, grupos y sprint siguen la categoría oficial de cada estado, también en procesos personalizados."],
      fr: ["**Mon travail avec les vrais états d'Azure DevOps** : les work items affichent leur état et leur type comme dans Boards (Committed, Approved, Product Backlog Item…), avec leurs couleurs. Filtres, éléments en attente, groupes et sprint suivent la catégorie officielle de chaque état, y compris dans les processus personnalisés."],
      de: ["**Meine Arbeit mit den echten Azure-DevOps-Zuständen**: Work Items zeigen Zustand und Typ wie in Boards (Committed, Approved, Product Backlog Item …) in den dortigen Farben. Filter, offene Einträge, Gruppen und Sprint folgen der offiziellen Kategorie jedes Zustands, auch in angepassten Prozessen."],
      it: ["**Il mio lavoro con gli stati reali di Azure DevOps**: i work item mostrano stato e tipo come in Boards (Committed, Approved, Product Backlog Item…), con i loro colori. Filtri, elementi in sospeso, gruppi e sprint seguono la categoria ufficiale di ogni stato, anche nei processi personalizzati."],
      ja: ["**マイワークで Azure DevOps の実際の状態を表示**：作業項目の状態と種類を Boards と同じ名前と色で表示します（Committed、Approved、Product Backlog Item など）。フィルター、未完了、グループ、スプリントは各状態の公式カテゴリに従い、カスタムプロセスにも対応します。"],
      zh: ["**我的工作显示 Azure DevOps 的真实状态**：工作项按 Boards 中的名称和颜色显示状态与类型（Committed、Approved、Product Backlog Item 等）。筛选、待处理、分组和冲刺都遵循每个状态的官方类别，也支持自定义流程。"],
      ko: ["**내 작업에 Azure DevOps의 실제 상태 표시**: 작업 항목의 상태와 유형을 Boards와 같은 이름과 색으로 보여 줍니다(Committed, Approved, Product Backlog Item 등). 필터, 대기 항목, 그룹, 스프린트는 각 상태의 공식 범주를 따르며 사용자 지정 프로세스도 지원합니다."],
      ru: ["**Моя работа с реальными состояниями Azure DevOps**: рабочие элементы показывают состояние и тип как в Boards (Committed, Approved, Product Backlog Item…), в тех же цветах. Фильтры, незавершённое, группы и спринт следуют официальной категории каждого состояния, в том числе в настраиваемых процессах."],
    },
  },
  {
    version: "0.3.1",
    notes: {
      pt: ["**Meu trabalho**: o Polvo não fecha mais ao abrir “Configurar” e procurar suas contas do GitHub e do Azure DevOps."],
      en: ["**My work**: Polvo no longer closes when you open “Set up” and it looks for your GitHub and Azure DevOps accounts."],
      es: ["**Mi trabajo**: Polvo ya no se cierra al abrir “Configurar” y buscar tus cuentas de GitHub y Azure DevOps."],
      fr: ["**Mon travail** : Polvo ne se ferme plus quand vous ouvrez « Configurer » et qu'il recherche vos comptes GitHub et Azure DevOps."],
      de: ["**Meine Arbeit**: Polvo schließt sich nicht mehr, wenn du „Einrichten“ öffnest und es deine GitHub- und Azure-DevOps-Konten sucht."],
      it: ["**Il mio lavoro**: Polvo non si chiude più quando apri “Configura” e cerca i tuoi account GitHub e Azure DevOps."],
      ja: ["**マイワーク**：「設定」を開いて GitHub と Azure DevOps のアカウントを検出するときに Polvo が終了してしまう問題を修正しました。"],
      zh: ["**我的工作**：打开“设置”并查找你的 GitHub 和 Azure DevOps 账户时，Polvo 不会再意外关闭。"],
      ko: ["**내 작업**: “설정”을 열어 GitHub와 Azure DevOps 계정을 찾을 때 Polvo가 종료되던 문제를 고쳤습니다."],
      ru: ["**Моя работа**: Polvo больше не закрывается, когда вы открываете «Настроить» и он ищет ваши аккаунты GitHub и Azure DevOps."],
    },
  },
  {
    version: "0.3.0",
    notes: {
      pt: [
        "**Meu trabalho** (Ctrl+Shift+3): uma nova tela com seus commits, issues e PRs do GitHub e work items, sprint e PRs do Azure DevOps, num lugar só. A lista “Para fazer” traz os bugs urgentes primeiro, filtra pendentes e só bugs, e aguenta backlogs grandes com busca, grupos e atalhos de teclado.",
        "**Leve um item para um agente** com a tecla A: implementar, implementar numa worktree nova, planejar antes ou investigar um bug, já com a descrição e os comentários no prompt. Veja e responda os comentários sem sair do Polvo, ou abra o registro no navegador com O.",
        "**Conexão simples e segura**: usa o login que você já tem no GitHub CLI e no Azure CLI (ou entre pelo navegador com um código), com PAT como alternativa. Os tokens ficam no Gerenciador de Credenciais do Windows.",
      ],
      en: [
        "**My work** (Ctrl+Shift+3): a new view with your commits, GitHub issues and PRs, and Azure DevOps work items, sprint and PRs in one place. The “To do” list puts urgent bugs first, filters pending items and bugs only, and handles large backlogs with search, groups and keyboard shortcuts.",
        "**Hand an item to an agent** with the A key: implement, implement in a new worktree, plan first or investigate a bug, with the description and comments already in the prompt. Read and reply to comments without leaving Polvo, or open the record in the browser with O.",
        "**Simple, secure connection**: reuses the login you already have in GitHub CLI and Azure CLI (or sign in through the browser with a code), with a PAT as a fallback. Tokens stay in Windows Credential Manager.",
      ],
      es: [
        "**Mi trabajo** (Ctrl+Shift+3): una nueva vista con tus commits, issues y PRs de GitHub, y work items, sprint y PRs de Azure DevOps en un solo lugar. La lista “Por hacer” pone primero los bugs urgentes, filtra pendientes y solo bugs, y aguanta backlogs grandes con búsqueda, grupos y atajos de teclado.",
        "**Lleva un elemento a un agente** con la tecla A: implementar, implementar en una worktree nueva, planificar antes o investigar un bug, con la descripción y los comentarios ya en el prompt. Lee y responde comentarios sin salir de Polvo, o abre el registro en el navegador con O.",
        "**Conexión simple y segura**: usa el inicio de sesión que ya tienes en GitHub CLI y Azure CLI (o entra por el navegador con un código), con PAT como alternativa. Los tokens se guardan en el Administrador de credenciales de Windows.",
      ],
      fr: [
        "**Mon travail** (Ctrl+Shift+3) : une nouvelle vue qui réunit vos commits, les issues et PR GitHub, et les work items, le sprint et les PR Azure DevOps. La liste « À faire » met les bugs urgents en tête, filtre les éléments en attente et les bugs, et gère les gros backlogs avec recherche, groupes et raccourcis clavier.",
        "**Confiez un élément à un agent** avec la touche A : implémenter, implémenter dans une nouvelle worktree, planifier d'abord ou enquêter sur un bug, avec la description et les commentaires déjà dans le prompt. Lisez et répondez aux commentaires sans quitter Polvo, ou ouvrez l'élément dans le navigateur avec O.",
        "**Connexion simple et sûre** : réutilise votre connexion à GitHub CLI et Azure CLI (ou connectez-vous dans le navigateur avec un code), avec un PAT en secours. Les tokens restent dans le Gestionnaire d'identification de Windows.",
      ],
      de: [
        "**Meine Arbeit** (Strg+Umschalt+3): eine neue Ansicht mit deinen Commits, GitHub-Issues und -PRs sowie Azure-DevOps-Work-Items, Sprint und PRs an einem Ort. Die Liste „Zu erledigen“ zeigt dringende Bugs zuerst, filtert offene Einträge und nur Bugs und bewältigt große Backlogs mit Suche, Gruppen und Tastenkürzeln.",
        "**Übergib einen Eintrag an einen Agenten** mit der Taste A: implementieren, in einer neuen Worktree implementieren, erst planen oder einen Bug untersuchen – Beschreibung und Kommentare stehen schon im Prompt. Lies und beantworte Kommentare direkt in Polvo oder öffne den Eintrag mit O im Browser.",
        "**Einfache, sichere Verbindung**: nutzt deine bestehende Anmeldung in GitHub CLI und Azure CLI (oder melde dich im Browser mit einem Code an), mit PAT als Alternative. Die Tokens bleiben in der Windows-Anmeldeinformationsverwaltung.",
      ],
      it: [
        "**Il mio lavoro** (Ctrl+Maiusc+3): una nuova vista con i tuoi commit, le issue e le PR di GitHub e i work item, lo sprint e le PR di Azure DevOps in un unico posto. La lista “Da fare” mette prima i bug urgenti, filtra gli elementi in sospeso e solo i bug, e regge backlog grandi con ricerca, gruppi e scorciatoie da tastiera.",
        "**Affida un elemento a un agente** con il tasto A: implementare, implementare in una nuova worktree, pianificare prima o indagare su un bug, con descrizione e commenti già nel prompt. Leggi e rispondi ai commenti senza uscire da Polvo, o apri l'elemento nel browser con O.",
        "**Connessione semplice e sicura**: usa l'accesso che hai già in GitHub CLI e Azure CLI (o accedi dal browser con un codice), con un PAT come alternativa. I token restano in Gestione credenziali di Windows.",
      ],
      ja: [
        "**マイワーク**（Ctrl+Shift+3）：コミット、GitHub の Issue と PR、Azure DevOps の作業項目・スプリント・PR を 1 か所にまとめた新しいビュー。「やること」リストは緊急のバグを先頭に表示し、未完了やバグだけの絞り込み、検索・グループ・キーボードショートカットで大きなバックログも扱えます。",
        "**A キーで項目をエージェントへ**：実装、新しい worktree での実装、先に計画、バグの調査を選べ、説明とコメントはプロンプトに入った状態で渡されます。コメントは Polvo の中で読んで返信でき、O キーでブラウザーの元の項目を開けます。",
        "**シンプルで安全な接続**：GitHub CLI と Azure CLI の既存のログインを使います（またはブラウザーでコードを入力してサインイン）。代わりに PAT も使えます。トークンは Windows 資格情報マネージャーに保存されます。",
      ],
      zh: [
        "**我的工作**（Ctrl+Shift+3）：全新视图，把你的提交、GitHub 的 issue 和 PR，以及 Azure DevOps 的工作项、冲刺和 PR 集中在一处。“待办”列表把紧急 bug 放在最前，可只看待处理项或只看 bug，并通过搜索、分组和快捷键应对大型待办列表。",
        "**按 A 键把条目交给智能体**：实现、在新 worktree 中实现、先做计划或调查 bug，描述和评论已自动放进提示词。无需离开 Polvo 即可查看和回复评论，按 O 在浏览器中打开原条目。",
        "**简单安全的连接**：复用你在 GitHub CLI 和 Azure CLI 中已有的登录（或在浏览器中输入代码登录），也可改用 PAT。令牌保存在 Windows 凭据管理器中。",
      ],
      ko: [
        "**내 작업**(Ctrl+Shift+3): 커밋, GitHub 이슈와 PR, Azure DevOps 작업 항목·스프린트·PR을 한곳에 모은 새 화면입니다. “할 일” 목록은 긴급 버그를 먼저 보여 주고, 대기 중인 항목이나 버그만 걸러 볼 수 있으며, 검색·그룹·단축키로 큰 백로그도 다룰 수 있습니다.",
        "**A 키로 항목을 에이전트에게**: 구현, 새 worktree에서 구현, 먼저 계획, 버그 조사 중에서 고를 수 있고 설명과 댓글이 프롬프트에 담겨 전달됩니다. Polvo를 떠나지 않고 댓글을 읽고 답할 수 있으며, O 키로 브라우저에서 원본 항목을 엽니다.",
        "**간단하고 안전한 연결**: GitHub CLI와 Azure CLI에 이미 로그인된 계정을 그대로 쓰거나 브라우저에서 코드로 로그인하며, PAT도 쓸 수 있습니다. 토큰은 Windows 자격 증명 관리자에 보관됩니다.",
      ],
      ru: [
        "**Моя работа** (Ctrl+Shift+3): новый экран, где собраны ваши коммиты, issues и PR из GitHub, а также рабочие элементы, спринт и PR из Azure DevOps. Список «К выполнению» показывает срочные баги первыми, фильтрует незавершённое и только баги и справляется с большими бэклогами благодаря поиску, группам и горячим клавишам.",
        "**Передайте элемент агенту** клавишей A: реализовать, реализовать в новом worktree, сначала спланировать или разобраться с багом — описание и комментарии уже будут в промпте. Читайте комментарии и отвечайте на них, не выходя из Polvo, или откройте запись в браузере клавишей O.",
        "**Простое и безопасное подключение**: используется ваш вход в GitHub CLI и Azure CLI (или вход в браузере по коду), PAT — как запасной вариант. Токены хранятся в диспетчере учётных данных Windows.",
      ],
    },
  },
  {
    version: "0.2.2",
    notes: {
      pt: ["**Telas menores**: Ajustes e os demais diálogos rolam por dentro, com os botões sempre à vista; popovers e grades se ajustam a janelas estreitas ou baixas."],
      en: ["**Smaller screens**: Settings and the other dialogs scroll inside, with their buttons always in view; popovers and grids adapt to narrow or short windows."],
      es: ["**Pantallas más pequeñas**: Ajustes y los demás diálogos se desplazan por dentro, con los botones siempre visibles; los popovers y las cuadrículas se adaptan a ventanas estrechas o bajas."],
      fr: ["**Petits écrans** : les Réglages et les autres boîtes de dialogue défilent à l’intérieur, avec les boutons toujours visibles ; popovers et grilles s’adaptent aux fenêtres étroites ou basses."],
      de: ["**Kleinere Bildschirme**: Einstellungen und die anderen Dialoge scrollen innen, die Schaltflächen bleiben immer sichtbar; Popover und Raster passen sich schmalen oder niedrigen Fenstern an."],
      it: ["**Schermi più piccoli**: Impostazioni e le altre finestre di dialogo scorrono all’interno, con i pulsanti sempre visibili; popover e griglie si adattano a finestre strette o basse."],
      ja: ["**小さな画面に対応**: 設定などのダイアログは内側でスクロールし、ボタンは常に表示されます。ポップオーバーやグリッドも狭い・低いウィンドウに合わせて調整されます。"],
      zh: ["**适配小屏幕**：设置等对话框在内部滚动，按钮始终可见；弹出框和网格会适应窄或矮的窗口。"],
      ko: ["**작은 화면 지원**: 설정과 다른 대화 상자가 내부에서 스크롤되며 버튼은 항상 보입니다. 팝오버와 그리드도 좁거나 낮은 창에 맞춰집니다."],
      ru: ["**Небольшие экраны**: настройки и другие диалоги прокручиваются внутри, кнопки всегда на виду; всплывающие окна и сетки подстраиваются под узкие и низкие окна."],
    },
  },
  {
    version: "0.2.1",
    notes: {
      pt: [
        "**Cor e ícone por projeto**: clique com o botão direito num projeto da barra lateral (ou escolha ao criar e clonar). As sessões sem cor própria herdam a cor do projeto.",
        "**Barra lateral recolhida mostra projetos**: um item por projeto, com ícone ou iniciais, quantidade de sessões e o status mais urgente; clique para ver as sessões.",
        "A caixa de commit volta para o lugar quando o repositório não tem alterações.",
        "Colaboradores na tela **Sobre** e nos READMEs, sem nomes repetidos e com link para o perfil no GitHub.",
        "Primeiras contribuições da comunidade. Obrigado, @GabrielFranciscon!",
      ],
      en: [
        "**Project color and icon**: right-click a project in the sidebar (or pick them when creating or cloning). Sessions without their own color inherit the project's.",
        "**Collapsed sidebar shows projects**: one item per project, with its icon or initials, session count and most urgent status; click to see its sessions.",
        "The commit box stays in place when the repository has no changes.",
        "Contributors in the **About** screen and the READMEs, without duplicate names and linking to their GitHub profiles.",
        "First community contributions. Thank you, @GabrielFranciscon!",
      ],
      es: [
        "**Color e icono por proyecto**: haz clic derecho en un proyecto de la barra lateral (o elígelos al crear y clonar). Las sesiones sin color propio heredan el del proyecto.",
        "**La barra lateral contraída muestra proyectos**: un elemento por proyecto, con icono o iniciales, número de sesiones y el estado más urgente; haz clic para ver sus sesiones.",
        "El cuadro de commit vuelve a su sitio cuando el repositorio no tiene cambios.",
        "Colaboradores en la pantalla **Acerca de** y en los README, sin nombres repetidos y con enlace a su perfil de GitHub.",
        "Primeras contribuciones de la comunidad. ¡Gracias, @GabrielFranciscon!",
      ],
      fr: [
        "**Couleur et icône par projet** : clic droit sur un projet dans la barre latérale (ou au moment de créer et cloner). Les sessions sans couleur propre héritent de celle du projet.",
        "**La barre latérale réduite affiche les projets** : un élément par projet, avec icône ou initiales, nombre de sessions et statut le plus urgent ; cliquez pour voir ses sessions.",
        "La zone de commit reste à sa place quand le dépôt n’a pas de modifications.",
        "Contributeurs dans l’écran **À propos** et les README, sans noms en double et avec un lien vers leur profil GitHub.",
        "Premières contributions de la communauté. Merci, @GabrielFranciscon !",
      ],
      de: [
        "**Farbe und Symbol pro Projekt**: Rechtsklick auf ein Projekt in der Seitenleiste (oder beim Erstellen und Klonen wählen). Sitzungen ohne eigene Farbe übernehmen die des Projekts.",
        "**Eingeklappte Seitenleiste zeigt Projekte**: ein Eintrag pro Projekt mit Symbol oder Initialen, Anzahl der Sitzungen und dringendstem Status; Klick zeigt die Sitzungen.",
        "Das Commit-Feld bleibt an seinem Platz, wenn das Repository keine Änderungen hat.",
        "Mitwirkende im **Info**-Fenster und in den READMEs, ohne doppelte Namen und mit Link zum GitHub-Profil.",
        "Erste Beiträge aus der Community. Danke, @GabrielFranciscon!",
      ],
      it: [
        "**Colore e icona per progetto**: clic destro su un progetto nella barra laterale (o sceglili quando crei e cloni). Le sessioni senza colore proprio ereditano quello del progetto.",
        "**La barra laterale compressa mostra i progetti**: un elemento per progetto, con icona o iniziali, numero di sessioni e stato più urgente; clicca per vedere le sessioni.",
        "La casella di commit resta al suo posto quando il repository non ha modifiche.",
        "Contributori nella schermata **Informazioni** e nei README, senza nomi duplicati e con link al profilo GitHub.",
        "Primi contributi della community. Grazie, @GabrielFranciscon!",
      ],
      ja: [
        "**プロジェクトごとの色とアイコン**: サイドバーのプロジェクトを右クリック（作成・クローン時にも選択可）。独自の色がないセッションはプロジェクトの色を引き継ぎます。",
        "**折りたたんだサイドバーにプロジェクトを表示**: プロジェクトごとに 1 項目で、アイコンまたはイニシャル、セッション数、最も急ぎの状態を表示。クリックでセッション一覧。",
        "変更がないリポジトリでもコミット欄が正しい位置に表示されます。",
        "**情報**画面と README のコントリビューター一覧から重複をなくし、GitHub プロフィールへのリンクを追加。",
        "コミュニティからの初めてのコントリビューション。ありがとう、@GabrielFranciscon！",
      ],
      zh: [
        "**按项目设置颜色和图标**：在侧边栏右键单击项目（创建和克隆时也可选择）。没有自己颜色的会话会继承项目的颜色。",
        "**折叠的侧边栏显示项目**：每个项目一项，带图标或首字母、会话数量和最紧急的状态；点击查看其会话。",
        "仓库没有更改时，提交框会保持在原位。",
        "**关于**界面和 README 中的贡献者列表不再重复，并链接到其 GitHub 个人主页。",
        "首批社区贡献。感谢 @GabrielFranciscon！",
      ],
      ko: [
        "**프로젝트별 색상과 아이콘**: 사이드바에서 프로젝트를 마우스 오른쪽 버튼으로 클릭하세요(생성·복제할 때도 선택 가능). 자체 색상이 없는 세션은 프로젝트 색상을 따릅니다.",
        "**접힌 사이드바에 프로젝트 표시**: 프로젝트마다 하나씩, 아이콘 또는 이니셜, 세션 수, 가장 급한 상태를 보여 주며 클릭하면 세션이 열립니다.",
        "저장소에 변경 사항이 없을 때도 커밋 상자가 제자리에 있습니다.",
        "**정보** 화면과 README의 기여자 목록에서 중복을 없애고 GitHub 프로필 링크를 추가했습니다.",
        "커뮤니티의 첫 기여입니다. 고마워요, @GabrielFranciscon!",
      ],
      ru: [
        "**Цвет и значок проекта**: щёлкните проект в боковой панели правой кнопкой (или выберите при создании и клонировании). Сессии без своего цвета наследуют цвет проекта.",
        "**Свёрнутая боковая панель показывает проекты**: по одному элементу на проект — значок или инициалы, число сессий и самый срочный статус; щелчок открывает сессии.",
        "Поле коммита остаётся на месте, когда в репозитории нет изменений.",
        "Участники в окне **О программе** и в README — без повторов и со ссылками на профили GitHub.",
        "Первые вклады сообщества. Спасибо, @GabrielFranciscon!",
      ],
    },
  },
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
