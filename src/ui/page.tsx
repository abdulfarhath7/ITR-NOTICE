/** The page frame every screen shares: a sticky head with the title and
 *  its actions, then the body. The loading and error frames are here too
 *  so no screen invents its own. */
import { href, type Route } from "../lib/router";
import Icon from "./icons";

export function Page({ children }: { children: React.ReactNode }) {
  return <div className="page">{children}</div>;
}

export function PageHead({ title, back, meta, children }: {
  title: React.ReactNode;
  /** A crumb back to the parent screen, shown before the title. */
  back?: { route: Route; label: string };
  /** Quiet text right after the title: a count, a PAN, a type. */
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      {back ? (
        <a className="crumb" href={href(back.route)}>
          <Icon name="arrow-left" />
          <span>{back.label}</span>
        </a>
      ) : null}
      <h1>{title}</h1>
      {meta ? <span className="page-meta">{meta}</span> : null}
      <span className="grow" />
      {children}
    </div>
  );
}

export function PageBody({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
  return <div className={`page-body${narrow ? " narrow" : ""}`}>{children}</div>;
}

export function LoadingPage() {
  return <div className="page"><div className="loading">Loading</div></div>;
}

export function ErrorPage({ message }: { message: string }) {
  return (
    <div className="page">
      <div className="page-body"><div className="banner danger" role="alert">{message}</div></div>
    </div>
  );
}
