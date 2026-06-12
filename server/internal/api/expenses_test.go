package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"expense-tracker/internal/service"
)

// stubExpenseService satisfies ExpenseService for handler tests. Only the
// methods exercised by the test under inspection need real behavior; the
// rest panic to make accidental use obvious.
type stubExpenseService struct {
	lastWindow  service.ListWindowOptions
	windowRows  []service.Expense
	windowTotal int64
}

func (s *stubExpenseService) Create(context.Context, service.ExpenseInput) (*service.Expense, error) {
	panic("not used")
}
func (s *stubExpenseService) List(context.Context) ([]service.Expense, error) {
	panic("not used")
}
func (s *stubExpenseService) ListWindow(_ context.Context, opts service.ListWindowOptions) ([]service.Expense, error) {
	s.lastWindow = opts
	return s.windowRows, nil
}
func (s *stubExpenseService) SumWindow(_ context.Context, opts service.ListWindowOptions) (int64, error) {
	s.lastWindow = opts
	return s.windowTotal, nil
}
func (s *stubExpenseService) Get(context.Context, string) (*service.Expense, error) {
	panic("not used")
}
func (s *stubExpenseService) Update(context.Context, string, service.ExpenseInput) (*service.Expense, error) {
	panic("not used")
}
func (s *stubExpenseService) Delete(context.Context, string) error { panic("not used") }

func TestListExpensesDefaultsToLast30DaysAndReturnsCursorWhenShortPage(t *testing.T) {
	stub := &stubExpenseService{
		windowRows: []service.Expense{
			{ID: "a", Date: time.Now().Unix()},
		},
	}
	h := listExpenses(stub)

	req := httptest.NewRequest(http.MethodGet, "/api/expenses", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	// Default window must be roughly 30 days wide.
	windowSeconds := stub.lastWindow.Before - stub.lastWindow.Since
	wantSeconds := int64(30*24*time.Hour/time.Second) + 1 // before is now+1
	if windowSeconds < wantSeconds-2 || windowSeconds > wantSeconds+2 {
		t.Fatalf("default window: expected ~%d seconds, got %d", wantSeconds, windowSeconds)
	}
	if stub.lastWindow.Limit != expenseDefaultLimit {
		t.Fatalf("default limit: expected %d, got %d", expenseDefaultLimit, stub.lastWindow.Limit)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if cursor, ok := body["next_before"].(float64); !ok || int64(cursor) != stub.windowRows[0].Date {
		t.Fatalf("partial page should advertise cursor for loading older history, got %v", body)
	}
}

func TestListExpensesReturnsCursorOnFullPage(t *testing.T) {
	rows := make([]service.Expense, expenseDefaultLimit)
	now := time.Now().Unix()
	for i := range rows {
		rows[i] = service.Expense{ID: "x", Date: now - int64(i)}
	}
	stub := &stubExpenseService{windowRows: rows}
	h := listExpenses(stub)

	req := httptest.NewRequest(http.MethodGet, "/api/expenses", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	cursor, ok := body["next_before"].(float64)
	if !ok {
		t.Fatalf("expected next_before in full page, got %v", body)
	}
	if int64(cursor) != rows[len(rows)-1].Date {
		t.Fatalf("cursor: expected oldest row's date %d, got %d", rows[len(rows)-1].Date, int64(cursor))
	}
}

func TestListExpensesExplicitBeforeDisablesDefaultFloor(t *testing.T) {
	stub := &stubExpenseService{}
	h := listExpenses(stub)

	req := httptest.NewRequest(http.MethodGet, "/api/expenses?before=12345&limit=10", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if stub.lastWindow.Before != 12345 {
		t.Fatalf("before: expected 12345, got %d", stub.lastWindow.Before)
	}
	if stub.lastWindow.Since != 0 {
		t.Fatalf("since: expected 0 when before is explicit, got %d", stub.lastWindow.Since)
	}
	if stub.lastWindow.Limit != 10 {
		t.Fatalf("limit: expected 10, got %d", stub.lastWindow.Limit)
	}
}

func TestListExpensesAcceptsExplicitDateWindowAndReturnsTotal(t *testing.T) {
	stub := &stubExpenseService{windowTotal: 1234}
	h := listExpenses(stub)

	req := httptest.NewRequest(http.MethodGet, "/api/expenses?since=100&before=200&limit=10", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if stub.lastWindow.Since != 100 || stub.lastWindow.Before != 200 {
		t.Fatalf("window: expected [100,200), got [%d,%d)", stub.lastWindow.Since, stub.lastWindow.Before)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := int64(body["total"].(float64)); got != 1234 {
		t.Fatalf("total: expected 1234, got %d", got)
	}
}

func TestListExpensesCapsLimitAtMax(t *testing.T) {
	stub := &stubExpenseService{}
	h := listExpenses(stub)

	req := httptest.NewRequest(http.MethodGet, "/api/expenses?limit=99999", nil)
	rec := httptest.NewRecorder()
	h(rec, req)

	if stub.lastWindow.Limit != expenseMaxLimit {
		t.Fatalf("limit: expected cap %d, got %d", expenseMaxLimit, stub.lastWindow.Limit)
	}
}

func TestListExpensesRejectsBadParams(t *testing.T) {
	stub := &stubExpenseService{}
	h := listExpenses(stub)

	for _, q := range []string{"before=abc", "before=0", "before=-1", "since=abc", "since=-1", "since=200&before=100", "limit=abc", "limit=0"} {
		t.Run(q, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/expenses?"+q, nil)
			rec := httptest.NewRecorder()
			h(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("query %q: expected 400, got %d (%s)", q, rec.Code, rec.Body.String())
			}
		})
	}
}
