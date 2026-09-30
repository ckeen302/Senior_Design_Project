import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { TradeCard } from "../components/TradeCard";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { useAuthStore } from "../store/authStore";

const trade = {
  id: "t1",
  company_id: "c1",
  accession_number: "0001104659-26-106432",
  filing_date: "2026-09-28T09:00:00Z",
  transaction_date: "2026-09-26",
  reporting_owner_name: "DOE JANE",
  owner_title: "Chief Executive Officer, Director",
  transaction_code: "P",
  shares: 10000,
  price_per_share: 125,
  total_value: 1_250_000,
  is_direct: true,
  post_transaction_shares: 50000,
  insider_cik: "0000000009",
  is_10b5_1: false,
  is_sell_to_cover: false,
  is_option_sale: false,
  price_suspect: false,
  parser_version: 3,
  signal_direction: 1,
  stake_change_pct: 25,
};

const acme = { id: "c1", ticker: "ACME", company_name: "Acme Corp", cik: "0000000001" };
const NOW = Date.parse("2026-09-28T12:00:00Z");

describe("TradeCard", () => {
  it("tells the trade in plain English: who, what, how much, stake change, when", async () => {
    await render(<TradeCard trade={trade} company={acme} now={NOW} relatedFilers={1} />);
    expect(screen.getByText("ACME")).toBeTruthy();
    expect(screen.getByText("Bought $1.3M")).toBeTruthy();
    expect(screen.getByText("Doe Jane · CEO")).toBeTruthy();
    expect(screen.getByText("10,000 sh @ $125.00 · +25% stake")).toBeTruthy();
    expect(screen.getByText("Open-market buy")).toBeTruthy();
    expect(screen.getByText("+1 related filer")).toBeTruthy();
    expect(screen.getByText("3h ago")).toBeTruthy();
  });

  it("marks pre-planned and tax sales as routine", async () => {
    await render(
      <TradeCard
        trade={{ ...trade, transaction_code: "S", is_10b5_1: true, signal_direction: 0, stake_change_pct: 2 }}
        company={acme}
        now={NOW}
      />,
    );
    expect(screen.getByText("Sold $1.3M")).toBeTruthy();
    expect(screen.getByText("10b5-1 plan · routine")).toBeTruthy();
  });

  it("never repeats an implausible dollar amount", async () => {
    await render(
      <TradeCard
        trade={{ ...trade, shares: 40_000_000, price_per_share: 40_000_000, total_value: 1.6e15, price_suspect: true, signal_direction: 0 }}
        company={acme}
        now={NOW}
      />,
    );
    expect(screen.getByText("Bought 40,000,000 shares")).toBeTruthy();
    expect(screen.getByText("Price looks wrong in filing · routine")).toBeTruthy();
    expect(screen.queryByText(/\$1\.6/)).toBeNull();
  });
});

describe("LoginScreen", () => {
  const navigation = { navigate: jest.fn() } as never;
  const route = { key: "Login", name: "Login" } as never;

  it("validates before calling Supabase", async () => {
    const signIn = jest.fn().mockResolvedValue({ error: null });
    useAuthStore.setState({ signIn });
    await render(<LoginScreen navigation={navigation} route={route} />);

    await fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByText("Email is required.")).toBeTruthy();
    expect(screen.getByText("Password is required.")).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("signs in and surfaces auth errors", async () => {
    const signIn = jest.fn().mockResolvedValue({ error: "Incorrect email or password." });
    useAuthStore.setState({ signIn });
    await render(<LoginScreen navigation={navigation} route={route} />);

    await fireEvent.changeText(screen.getByTestId("login-email"), "student@university.edu");
    await fireEvent.changeText(screen.getByTestId("login-password"), "wrong-password");
    await fireEvent.press(screen.getByTestId("login-submit"));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith("student@university.edu", "wrong-password"));
    expect(await screen.findByText("Incorrect email or password.")).toBeTruthy();
  });
});
