package config

import (
	"fmt"
	"os"
)

type Config struct {
	PGURL      string
	Port       string
	Neo4jURI   string
	Neo4jUser  string
	Neo4jPass  string
}

func Load() Config {
	c := Config{
		PGURL:     os.Getenv("PG_URL"),
		Port:      os.Getenv("PORT"),
		Neo4jURI:  os.Getenv("NEO4J_URI"),
		Neo4jUser: os.Getenv("NEO4J_USER"),
		Neo4jPass: os.Getenv("NEO4J_PASSWORD"),
	}
	if c.PGURL == "" {
		c.PGURL = "postgres://weave:weave@localhost:5432/weave?sslmode=disable"
	}
	if c.Port == "" {
		c.Port = "9091"
	}
	if c.Neo4jURI == "" {
		c.Neo4jURI = "bolt://localhost:7687"
	}
	if c.Neo4jUser == "" {
		c.Neo4jUser = "neo4j"
	}
	if c.Neo4jPass == "" {
		c.Neo4jPass = "spareparts"
	}
	return c
}

func (c Config) Addr() string {
	return fmt.Sprintf(":%s", c.Port)
}
