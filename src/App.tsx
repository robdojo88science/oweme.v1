import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Route,
  Routes,
  useBlocker,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Calculator,
  ChevronRight,
  CircleHelp,
  CloudOff,
  Command,
  Download,
  FileText,
  Home as HomeIcon,
  LayoutGrid,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Users,
  Wallet,
  WifiOff,
  X,
} from "lucide-react";
import { dataChanges, getSnapshot } from "./db";
import { loanBalance, normalizeSearch, todayManila } from "./finance";
import { queueDriveBackup } from "./drive";
import {
  AppLink,
  Avatar,
  DataContext,
  DateText,
  Modal,
  NavigationContext,
  useData,
  useGo,
} from "./ui";
import {
  Home,
  BorrowerList,
  BorrowerProfile,
  Transactions,
  Reminders,
  Activity,
} from "./screens";
import { LoanForm, PaymentForm } from "./forms";
import { Backups, Reports, SettingsPage } from "./settings";

const navItems = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/borrowers", label: "Borrowers", icon: Users },
  { to: "/loan", label: "New loan", icon: Calculator },
  { to: "/transactions", label: "Transactions", icon: ArrowDownLeft },
  { to: "/more", label: "More", icon: LayoutGrid },
];

function GlobalSearch({ close }: { close: () => void }) {
  const data = useData();
  const go = useGo();
  const [q, setQ] = useState("");
  const query = normalizeSearch(q);
  const matches = (s: string) => normalizeSearch(s).includes(query);
  const borrowers = data.borrowers
    .filter((b) =>
      matches([b.name, b.displayId, b.phone, b.address, b.notes].join(" ")),
    )
    .slice(0, 15);
  const entries = query
    ? data.entries
        .filter((e) =>
          matches(
            [
              e.ref,
              e.externalRef,
              data.borrowers.find((b) => b.id === e.borrowerId)?.name,
            ].join(" "),
          ),
        )
        .slice(-12)
        .reverse()
    : [];
  const loans = query
    ? data.loans.filter((l) => matches(l.ref)).slice(0, 8)
    : [];
  const docs = query
    ? data.attachments.filter((a) => matches(a.name)).slice(0, 8)
    : [];
  const open = (path: string) => {
    close();
    go(path);
  };
  return (
    <Modal title="Find anything" onClose={close}>
      <div className="search-input">
        <Search size={18} />
        <input
          aria-label="Search names, borrower IDs or transaction references"
          autoFocus
          placeholder="Name, borrower ID, receipt…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <p className="fine muted">Private search · works offline</p>
      <div className="search-results">
        {borrowers.length > 0 && (
          <>
            <p className="eyebrow">Borrowers</p>
            {borrowers.map((b) => (
              <button
                className="list-row"
                key={b.id}
                onClick={() => open(`/borrowers/${b.id}`)}
              >
                <Avatar name={b.name} />
                <span className="row-main">
                  <strong>{b.name}</strong>
                  <small>
                    #{b.displayId}
                    {b.archived ? " · Archived" : ""}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </>
        )}
        {entries.length > 0 && (
          <>
            <p className="eyebrow">Transactions</p>
            {entries.map((e) => (
              <button
                className="list-row"
                key={e.id}
                onClick={() => open(`/transactions?entry=${e.id}`)}
              >
                <FileText size={19} />
                <span className="row-main">
                  <strong>{e.ref}</strong>
                  <small>
                    {e.kind} · <DateText date={e.date} />
                  </small>
                </span>
              </button>
            ))}
          </>
        )}
        {loans.length > 0 && (
          <>
            <p className="eyebrow">Loans</p>
            {loans.map((l) => (
              <button
                className="list-row"
                key={l.id}
                onClick={() => open(`/borrowers/${l.borrowerId}`)}
              >
                <BookOpen size={19} />
                <span>{l.ref}</span>
              </button>
            ))}
          </>
        )}
        {docs.map((a) => (
          <button
            className="list-row"
            key={a.id}
            onClick={() => open(`/borrowers/${a.borrowerId}?tab=documents`)}
          >
            <FileText size={19} />
            <span>{a.name}</span>
          </button>
        ))}
        {!borrowers.length &&
          !entries.length &&
          !loans.length &&
          !docs.length && (
            <p className="empty-small">
              No matches. Try a name fragment or reference.
            </p>
          )}
      </div>
    </Modal>
  );
}

function More() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR NOTEBOOK, ORGANIZED</p>
          <h1>A little more control.</h1>
          <p className="muted">The details are here when you need them.</p>
        </div>
      </div>
      <div className="more-grid">
        {[
          {
            to: "/reports",
            icon: Wallet,
            label: "Reports",
            desc: "See cash movement and collections.",
          },
          {
            to: "/reminders",
            icon: BookOpen,
            label: "Due & reminders",
            desc: "Who’s due, who’s next, what’s late.",
          },
          {
            to: "/backups",
            icon: Download,
            label: "Backups & recovery",
            desc: "Keep a safe, portable copy.",
          },
          {
            to: "/activity",
            icon: Command,
            label: "Activity",
            desc: "A history that keeps its history.",
          },
          {
            to: "/settings",
            icon: Menu,
            label: "Settings",
            desc: "Your business and sensible defaults.",
          },
          {
            to: "/guide",
            icon: CircleHelp,
            label: "Help & privacy",
            desc: "A few things worth knowing.",
          },
        ].map(({ to, icon: Icon, label, desc }) => (
          <AppLink key={to} to={to} className="card more-card">
            <span className="more-icon">
              <Icon size={23} />
            </span>
            <h2>{label}</h2>
            <p className="muted">{desc}</p>
            <ChevronRight size={19} />
          </AppLink>
        ))}
      </div>
    </>
  );
}
function Guide() {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A SIMPLE GUIDE</p>
          <h1>Your notebook. Your device.</h1>
        </div>
      </div>
      <div className="card prose">
        <h2>From a name to a receipt</h2>
        <ol>
          <li>Add a borrower. Only their full name is required.</li>
          <li>
            Open New loan, enter what they’ll repay, and check the cash to give
            and schedule. Numbers update while you type.
          </li>
          <li>
            Preview the agreement, then review and explicitly confirm the cash
            release.
          </li>
          <li>
            Record each payment. Check the balance after, confirm once, and keep
            the receipt.
          </li>
        </ol>
        <h2>Install for offline use</h2>
        <p>
          Open OweMe online once and let its files finish caching. On iPhone or
          iPad: Safari → Share → Add to Home Screen. On Android or desktop, use
          your browser’s Install app option when offered. Test opening it in
          airplane mode before relying on it.
        </p>
        <h2>Keep a recoverable copy</h2>
        <p>
          Records and signed documents stay in this browser. Download backups
          regularly, keep them in a safe place, and use Verify backup to check
          the file. Losing the device or clearing browser storage can lose the
          local copy. Browser notifications while closed are not guaranteed.
        </p>
        <h2>Protect borrower information</h2>
        <p>
          Only collect details you need, explain their purpose, and keep a
          suitable lawful basis and retention policy. There is no required
          account or PIN. Anyone who can open this browser can see the notebook;
          protect the device with its own lock. Sharing and exporting may
          disclose personal information.
        </p>
        <h2>Terms deserve a careful review</h2>
        <p>
          The suggested fee is editable and does not establish legal compliance.
          A small lending activity can still have licensing, disclosure, privacy
          and fee obligations. Have the agreement and your lending practice
          reviewed by an appropriate Philippine professional. No late fees are
          added by OweMe.
        </p>
        <h2>Correcting a record</h2>
        <p>
          Issued loans keep their original financial terms. Reverse a mistaken
          payment with a reason, then record the correction. Archive hides a
          borrower from the directory while retaining history; privacy erasure
          is a separate decision that requires retention and legal review.
        </p>
        <AppLink className="button primary" to="/backups">
          Open backups <ArrowUpRight size={16} />
        </AppLink>
      </div>
    </>
  );
}

export default function App() {
  const snapshot = useLiveQuery(() => getSnapshot(), []);
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [destination, setDestination] = useState("");
  const [update, setUpdate] = useState(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);
  const go = useCallback(
    (path: string) => {
      if (dirtyRef.current && path !== `${location.pathname}${location.search}`)
        setDestination(path);
      else navigate(path);
    },
    [navigate, location.pathname, location.search],
  );
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    const refresh = () => setUpdate(true);
    const changes = () => queueDriveBackup();
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    window.addEventListener("oweme-update", refresh);
    dataChanges.addEventListener("change", changes);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      window.removeEventListener("oweme-update", refresh);
      dataChanges.removeEventListener("change", changes);
    };
  }, []);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    document.querySelector("main")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  if (!snapshot)
    return (
      <div className="opening">
        <span className="brand-symbol">o.</span>
        <p>Opening your local notebook…</p>
      </div>
    );
  const section = location.pathname.startsWith("/borrowers")
    ? "Borrowers"
    : location.pathname === "/loan"
      ? "New loan"
      : location.pathname === "/transactions"
        ? "Transactions"
        : location.pathname === "/"
          ? "Home"
          : "More";
  const outstanding = snapshot.loans.reduce(
    (sum, l) => sum + loanBalance(l, snapshot.entries),
    0,
  );
  return (
    <DataContext value={snapshot}>
      <NavigationContext value={{ go, setDirty: markDirty }}>
        <div className="app-shell">
          <aside className="sidebar">
            <AppLink to="/" className="brand">
              <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
              <span>
                OweMe<span className="brand-dot">.</span>
              </span>
            </AppLink>
            <div className="workspace-label">YOUR LENDING NOTEBOOK</div>
            <nav aria-label="Main navigation">
              {navItems.map(({ to, label, icon: Icon }) => (
                <AppLink
                  key={to}
                  to={to}
                  className={`nav-item ${section.toLowerCase() === label.toLowerCase() ? "active" : ""}`}
                  aria-label={label}
                >
                  <Icon size={20} />
                  <span>{label}</span>
                  {label === "New loan" && (
                    <Plus className="nav-plus" size={15} />
                  )}
                </AppLink>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="privacy-mark">
                <ShieldCheck size={19} />
                <div>
                  <strong>Just yours.</strong>
                  <small>Saved on this device</small>
                </div>
              </div>
              <AppLink to="/backups" className="backup-link">
                <CloudOff size={16} /> Keep a backup <ArrowUpRight size={14} />
              </AppLink>
              <div className="sidebar-footer">
                MADE FOR EVERYDAY TRUST<span>OweMe · v1.0</span>
              </div>
            </div>
          </aside>
          <div className="main-shell">
            <header className="topbar">
              <div className="breadcrumb">
                Your workspace <ChevronRight size={13} />
                <strong>{section}</strong>
              </div>
              <button
                className="global-search"
                onClick={() => setSearch(true)}
                aria-label="Search notebook"
              >
                <Search size={17} />
                <span>Search your notebook</span>
                <kbd>⌘ K</kbd>
              </button>
              <div className={`connection ${online ? "" : "offline"}`}>
                {online ? (
                  <span className="status-dot" />
                ) : (
                  <WifiOff size={14} />
                )}
                <span>{online ? "On this device" : "Working offline"}</span>
              </div>
              <div
                className="owner-avatar"
                title={snapshot.settings.ownerName || "Owner"}
              >
                {snapshot.settings.ownerName?.[0]?.toUpperCase() || "O"}
              </div>
            </header>
            {!online && (
              <div className="offline-banner">
                <WifiOff size={14} /> You’re offline. Your notebook still works;
                cloud backups will wait.
              </div>
            )}
            {update && (
              <div className="offline-banner">
                An update is ready. Finish your draft and reopen OweMe to update
                safely.
                <button
                  className="icon-button"
                  aria-label="Dismiss update"
                  onClick={() => setUpdate(false)}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <main id="main-content">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/borrowers" element={<BorrowerList />} />
                <Route path="/borrowers/:id" element={<BorrowerProfile />} />
                <Route path="/loan" element={<LoanForm />} />
                <Route path="/payment" element={<PaymentForm />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/reminders" element={<Reminders />} />
                <Route path="/activity" element={<Activity />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/backups" element={<Backups />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/guide" element={<Guide />} />
                <Route path="*" element={<More />} />
              </Routes>
              <footer className="main-footer">
                <span>
                  <ShieldCheck size={13} /> Private by default. Ready for real
                  life.
                </span>
                <span>PHP · Asia/Manila</span>
              </footer>
            </main>
          </div>
          <nav className="bottom-nav" aria-label="Mobile navigation">
            {navItems.map(({ to, label, icon: Icon }) => (
              <AppLink
                key={to}
                to={to}
                className={
                  section.toLowerCase() === label.toLowerCase() ? "active" : ""
                }
              >
                <Icon size={21} />
                <span>{label}</span>
              </AppLink>
            ))}
          </nav>
        </div>
        {search && <GlobalSearch close={() => setSearch(false)} />}
        {(destination || blocker.state === "blocked") && (
          <Modal
            title="Keep your changes?"
            onClose={() => {
              setDestination("");
              if (blocker.state === "blocked") blocker.reset();
            }}
          >
            <p>
              Your form has changes. Stay here to save your draft, or leave this
              form.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => {
                  setDestination("");
                  if (blocker.state === "blocked") blocker.reset();
                }}
              >
                Keep editing
              </button>
              <button
                className="button danger-button"
                onClick={() => {
                  markDirty(false);
                  if (blocker.state === "blocked") blocker.proceed();
                  else navigate(destination);
                  setDestination("");
                }}
              >
                Leave form
              </button>
            </div>
          </Modal>
        )}
        <span className="sr-only">
          {outstanding === 0 ? "No outstanding balance" : ""}
          <DateText date={todayManila()} />
        </span>
      </NavigationContext>
    </DataContext>
  );
}
