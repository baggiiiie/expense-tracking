package service_test

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"expense-tracker/internal/app"
	"expense-tracker/internal/service"
)

func TestWalletSuggestionConfirmCreatesExpenseAndAcceptsSuggestion(t *testing.T) {
	services := openWalletSuggestionServices(t)
	categoryID := firstCategoryID(t, services)
	amount := int64(1299)
	ws := createWalletSuggestion(t, services, amount)
	accepted, exp, err := services.WalletSuggestions.Confirm(t.Context(), "suggestion-1", service.ExpenseInput{ID: "expense-1", Amount: amount, Currency: "USD", CategoryID: categoryID, Merchant: "Coffee", Date: time.Now().Unix()})
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if ws.Status != "pending" {
		t.Fatalf("status: got %q", ws.Status)
	}
	if exp.ID != "expense-1" {
		t.Fatalf("expense id: got %q", exp.ID)
	}
	if accepted.Status != "accepted" || accepted.LinkedExpenseID == nil || *accepted.LinkedExpenseID != exp.ID {
		t.Fatalf("accepted suggestion = %#v, expense = %#v", accepted, exp)
	}
	got, err := services.Expenses.Get(t.Context(), exp.ID)
	if err != nil {
		t.Fatalf("get created expense: %v", err)
	}
	if got.Merchant != "Coffee" || got.Amount != amount {
		t.Fatalf("created expense = %#v", got)
	}
}

func TestWalletSuggestionConfirmAlreadyAcceptedRollsBackExpense(t *testing.T) {
	services := openWalletSuggestionServices(t)
	categoryID := firstCategoryID(t, services)
	amount := int64(1299)
	createWalletSuggestion(t, services, amount)
	confirmWalletSuggestion(t, services, categoryID, "expense-1", amount)

	_, _, err := services.WalletSuggestions.Confirm(t.Context(), "suggestion-1", service.ExpenseInput{ID: "expense-2", Amount: amount, Currency: "USD", CategoryID: categoryID, Merchant: "Coffee", Date: time.Now().Unix()})
	if !errors.Is(err, service.ErrWalletSuggestionNotPending) {
		t.Fatalf("second confirm: expected ErrWalletSuggestionNotPending, got %v", err)
	}
	if _, err := services.Expenses.Get(t.Context(), "expense-2"); err == nil {
		t.Fatal("second confirm created an orphan expense")
	}
}

func TestWalletSuggestionDismissAlreadyAcceptedReturnsConflictError(t *testing.T) {
	services := openWalletSuggestionServices(t)
	categoryID := firstCategoryID(t, services)
	amount := int64(1299)
	createWalletSuggestion(t, services, amount)
	confirmWalletSuggestion(t, services, categoryID, "expense-1", amount)

	_, err := services.WalletSuggestions.Dismiss(t.Context(), "suggestion-1")
	if !errors.Is(err, service.ErrWalletSuggestionNotPending) {
		t.Fatalf("dismiss accepted: expected ErrWalletSuggestionNotPending, got %v", err)
	}
}

func openWalletSuggestionServices(t *testing.T) app.Services {
	t.Helper()
	dir := t.TempDir()
	a, err := app.Open(filepath.Join(dir, "test.db"), filepath.Join(dir, "prefs.json"))
	if err != nil {
		t.Fatalf("open app: %v", err)
	}
	t.Cleanup(func() { _ = a.Close() })
	return a.Services()
}

func firstCategoryID(t *testing.T, services app.Services) string {
	t.Helper()
	cats, err := services.Categories.List(t.Context())
	if err != nil {
		t.Fatalf("list categories: %v", err)
	}
	if len(cats) == 0 {
		t.Fatal("expected seeded categories")
	}
	return cats[0].ID
}

func createWalletSuggestion(t *testing.T, services app.Services, amount int64) *service.WalletSuggestion {
	t.Helper()
	ws, err := services.WalletSuggestions.Create(t.Context(), service.WalletSuggestionInput{ID: "suggestion-1", Amount: &amount, Currency: "USD", Merchant: "Coffee", CapturedAt: time.Now().Unix(), Source: "shortcut"})
	if err != nil {
		t.Fatalf("create suggestion: %v", err)
	}
	return ws
}

func confirmWalletSuggestion(t *testing.T, services app.Services, categoryID string, expenseID string, amount int64) {
	t.Helper()
	_, _, err := services.WalletSuggestions.Confirm(t.Context(), "suggestion-1", service.ExpenseInput{ID: expenseID, Amount: amount, Currency: "USD", CategoryID: categoryID, Merchant: "Coffee", Date: time.Now().Unix()})
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
}
