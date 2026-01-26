// src/webapp/routes/people.routes.js
import express from "express";

export default function peopleRouter({ articles }) {
  const router = express.Router();

  // Search MIT People
  router.get("/search", (req, res) => {
    try {
      const { q, limit = 50 } = req.query;

      if (!q || !q.trim()) {
        return res.status(400).json({
          ok: false,
          error: "Missing search query parameter 'q'"
        });
      }

      const query = q.trim().toLowerCase();

      // Filter for people only
      const people = articles.filter(a => a.kind === "person");

      // Search across multiple fields
      const matches = people.filter(person => {
        const searchFields = [
          person.title,
          person.firstName,
          person.lastName,
          person.summary,
          person.ilpSummary,
          person.fullText,
          person.dlc,
          person.mitPeopleCategory,
          person.email,
          ...(person.ilpKeywords || []),
          ...(person.tags || [])
        ].filter(Boolean).map(field => String(field).toLowerCase());

        return searchFields.some(field => field.includes(query));
      });

      // Sort by relevance (title/name matches first)
      matches.sort((a, b) => {
        const aName = `${a.firstName} ${a.lastName}`.toLowerCase();
        const bName = `${b.firstName} ${b.lastName}`.toLowerCase();
        const aTitleMatch = a.title?.toLowerCase().includes(query);
        const bTitleMatch = b.title?.toLowerCase().includes(query);
        const aNameMatch = aName.includes(query);
        const bNameMatch = bName.includes(query);

        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        if (aTitleMatch && !bTitleMatch) return -1;
        if (!aTitleMatch && bTitleMatch) return 1;

        return 0;
      });

      // Apply limit
      const limitedMatches = matches.slice(0, parseInt(limit));

      res.json({
        ok: true,
        count: limitedMatches.length,
        total: matches.length,
        people: limitedMatches
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  });

  // Get person by email or URL
  router.get("/details", (req, res) => {
    try {
      const { email, url } = req.query;

      if (!email && !url) {
        return res.status(400).json({
          ok: false,
          error: "Missing either 'email' or 'url' parameter"
        });
      }

      const people = articles.filter(a => a.kind === "person");

      let person = null;
      if (email) {
        person = people.find(p => p.email?.toLowerCase() === email.toLowerCase());
      } else if (url) {
        person = people.find(p => p.url === url);
      }

      if (!person) {
        return res.status(404).json({
          ok: false,
          error: "Person not found"
        });
      }

      res.json({
        ok: true,
        person
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  });

  // List all MIT People with optional filters
  router.get("/list", (req, res) => {
    try {
      const {
        category,
        dlc,
        limit = 100,
        offset = 0
      } = req.query;

      let people = articles.filter(a => a.kind === "person");

      // Apply filters
      if (category) {
        people = people.filter(p =>
          p.mitPeopleCategory?.toLowerCase() === category.toLowerCase()
        );
      }

      if (dlc) {
        people = people.filter(p =>
          p.dlc?.toLowerCase().includes(dlc.toLowerCase())
        );
      }

      // Sort alphabetically by last name
      people.sort((a, b) => {
        const aLast = a.lastName || "";
        const bLast = b.lastName || "";
        return aLast.localeCompare(bLast);
      });

      // Apply pagination
      const total = people.length;
      const paginatedPeople = people.slice(
        parseInt(offset),
        parseInt(offset) + parseInt(limit)
      );

      res.json({
        ok: true,
        count: paginatedPeople.length,
        total: total,
        offset: parseInt(offset),
        limit: parseInt(limit),
        people: paginatedPeople
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  });

  // Get unique categories and DLCs
  router.get("/metadata", (req, res) => {
    try {
      const people = articles.filter(a => a.kind === "person");

      const categories = [...new Set(
        people.map(p => p.mitPeopleCategory).filter(Boolean)
      )].sort();

      const dlcs = [...new Set(
        people.map(p => p.dlc).filter(Boolean)
      )].sort();

      res.json({
        ok: true,
        totalPeople: people.length,
        categories,
        dlcs
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  });

  return router;
}
