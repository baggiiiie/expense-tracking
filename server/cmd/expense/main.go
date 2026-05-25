// Package main is the entrypoint for the expense tracking server.
package main

import (
	"os"

	"expense-tracker/internal/cli"
)

func main() {
	if err := cli.Execute(); err != nil {
		os.Exit(1)
	}
}
