package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

type feedbackImage struct {
	Data        string `json:"data"`        // base64-encoded
	ContentType string `json:"contentType"` // e.g. "image/png"
}

type feedbackRequest struct {
	Route   string          `json:"route"`
	Version string          `json:"version"`
	Body    string          `json:"body"`
	Images  []feedbackImage `json:"images"`
}

const (
	githubOwner = "baggiiiie"
	githubRepo  = "expense-tracking"
)

func submitFeedback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := os.Getenv("GITHUB_TOKEN")
		if token == "" {
			writeError(w, r, http.StatusInternalServerError, "feedback not configured")
			return
		}

		var req feedbackRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}

		if strings.TrimSpace(req.Body) == "" {
			writeError(w, r, http.StatusBadRequest, "feedback body is required")
			return
		}

		// Upload images to the repo and collect their URLs
		var imageURLs []string
		for i, img := range req.Images {
			ext := extensionFromContentType(img.ContentType)
			filename := fmt.Sprintf(".feedback/images/%s-%d%s", uuid.New().String()[:8], i, ext)
			rawURL, err := uploadFileToGitHub(token, filename, img.Data, fmt.Sprintf("feedback: upload image %d", i+1))
			if err != nil {
				writeError(w, r, http.StatusBadGateway, fmt.Sprintf("failed to upload image %d: %v", i+1, err))
				return
			}
			imageURLs = append(imageURLs, rawURL)
		}

		// Build issue body
		var body strings.Builder
		body.WriteString("**App:** Svelte web app\n\n")
		body.WriteString(fmt.Sprintf("**Route:** `%s`\n\n", req.Route))
		if v := strings.TrimSpace(req.Version); v != "" {
			body.WriteString(fmt.Sprintf("**Build:** `%s`\n\n", v))
		}
		body.WriteString(fmt.Sprintf("**Submitted:** %s\n\n", time.Now().UTC().Format(time.RFC3339)))
		body.WriteString("---\n\n")
		body.WriteString(req.Body)

		if len(imageURLs) > 0 {
			body.WriteString("\n\n---\n\n### Attached Images\n\n")
			for i, url := range imageURLs {
				body.WriteString(fmt.Sprintf("![image-%d](%s)\n\n", i+1, url))
			}
		}

		// Create GitHub issue
		title := fmt.Sprintf("Feedback from %s", req.Route)
		if err := createGitHubIssue(token, title, body.String()); err != nil {
			writeError(w, r, http.StatusBadGateway, fmt.Sprintf("failed to create issue: %v", err))
			return
		}

		writeJSON(w, http.StatusCreated, map[string]string{"status": "created"})
	}
}

func extensionFromContentType(ct string) string {
	switch ct {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ".png"
	}
}

func uploadFileToGitHub(token, path, base64Content, message string) (string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/contents/%s", githubOwner, githubRepo, path)

	payload := map[string]string{
		"message": message,
		"content": base64Content,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("PUT", url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 201 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("GitHub API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Content struct {
			DownloadURL string `json:"download_url"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return result.Content.DownloadURL, nil
}

func createGitHubIssue(token, title, body string) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/issues", githubOwner, githubRepo)

	payload := map[string]interface{}{
		"title":  title,
		"body":   body,
		"labels": []string{"feedback"},
	}
	jsonBody, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 201 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GitHub API returned %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}
