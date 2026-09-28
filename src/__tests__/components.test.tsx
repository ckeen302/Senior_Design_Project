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
};

describe("TradeCard", () => {
  it("shows the owner, title, currency value, badge and relative filing time", async () => {
    await render(
      <TradeCard
        trade={trade}
        company={{ id: "c1", ticker: "ACME", company_name: "Acme Corp", cik: "0000000001" }}
        now={Date.parse("2026-09-28T12:00:00Z")}
      />,
    );
    expect(screen.getByText("ACME")).toBeTruthy();
    expect(screen.getByText("Doe Jane")).toBeTruthy();
    expect(screen.getByText("Chief Executive Officer, Director")).toBeTruthy();
    expect(screen.getByText("$1,250,000")).toBeTruthy();
    expect(screen.getByText("Buy")).toBeTruthy();
    expect(screen.getByText(/Filed 3h ago/)).toBeTruthy();
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
