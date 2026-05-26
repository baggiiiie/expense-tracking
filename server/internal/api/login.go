package api

import (
	"crypto/subtle"
	"net/http"
	"os"

	"expense-tracker/internal/singleusersecret"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// loginHandler validates username/password from environment variables
// (LOGIN_USERNAME and LOGIN_PASSWORD) and, on success, issues the same
// session cookie used by the bearer-token auth exchange. This gives the
// PWA a familiar username/password login flow while reusing the existing
// cookie-based session infrastructure.
func loginHandler(syncSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}

		wantUser := os.Getenv("LOGIN_USERNAME")
		wantPass := os.Getenv("LOGIN_PASSWORD")

		if wantUser == "" || wantPass == "" {
			writeError(w, r, http.StatusInternalServerError, "login not configured")
			return
		}

		userOK := subtle.ConstantTimeCompare([]byte(req.Username), []byte(wantUser)) == 1
		passOK := subtle.ConstantTimeCompare([]byte(req.Password), []byte(wantPass)) == 1

		if !userOK || !passOK {
			writeError(w, r, http.StatusUnauthorized, "invalid credentials")
			return
		}

		// Issue the same session cookie that authExchange uses.
		http.SetCookie(w, &http.Cookie{
			Name:     singleusersecret.SessionCookieName,
			Value:    syncSecret,
			Path:     "/api",
			HttpOnly: true,
			Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
			SameSite: http.SameSiteStrictMode,
			MaxAge:   sessionCookieMaxAge,
		})
		w.WriteHeader(http.StatusNoContent)
	}
}
