import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { StatusBanners } from "./components/common.jsx";
import { Footer, Header } from "./components/Layout.jsx";
import {
  AboutPage,
  MoversPage,
  NotFoundPage,
  OverviewPage,
  SectorDetailPage,
  SectorsPage,
  StocksPage,
  WatchlistPage,
} from "./pages/ListPages.jsx";
import { AccountPage, SignInPage, SignUpPage } from "./pages/AuthPages.jsx";
import StockPage from "./pages/StockPage.jsx";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <div className="site">
      <ScrollToTop />
      <Header />
      <main className="content">
        <StatusBanners />
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/stocks" element={<StocksPage />} />
          <Route path="/stock/:symbol" element={<StockPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/movers" element={<MoversPage />} />
          <Route path="/sectors" element={<SectorsPage />} />
          <Route path="/sectors/:slug" element={<SectorDetailPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
