# Jira-koppeling met een service account

## Doel

De dashboardkoppeling leest tickets en actuele KPI's uit Jira. Gebruik daarvoor
bij voorkeur een Atlassian **service account** in plaats van een persoonlijke
API-token. De koppeling blijft dan werken als een medewerker van functie
verandert of uit dienst gaat.

Een API-token hoort altijd bij een identiteit. Bij een persoonlijke token is
dat een medewerker; bij deze aanpak is dat een technische identiteit die de
organisatie beheert. Het is dus geen token dat rechtstreeks “aan de
organisatie” hangt.

## Waarom een service account

- De koppeling is niet afhankelijk van één medewerker.
- Toegang kan beperkt blijven tot alleen het Servicedesk-project en alleen
  lezen.
- Het account en de tokens zijn centraal te beheren en in te trekken.
- Tokengebruik, verloop en vervanging zijn beter overdraagbaar.

Service accounts tellen niet mee als interactieve Jira-gebruikers en zijn niet
bedoeld om in te loggen in de Jira-webinterface. Ze krijgen wel, net als een
normale gebruiker, expliciet app-, project- en issue-rechten.

## Vereisten

- Organisatiebeheerderstoegang in Atlassian Administration.
- Beheerderstoegang in Jira om projectrollen en rechten toe te kennen.
- Toegang tot de secretopslag van de omgeving waarin het dashboard draait.
- Het Jira **cloud ID** van de Jira-site. Dit is iets anders dan het
  organisatie-ID.

## Stappenplan

### 1. Maak het service account aan

1. Open [Atlassian Administration](https://admin.atlassian.com/) en kies de
   juiste organisatie.
2. Ga naar **Directory → Service accounts**.
3. Kies **Add service account**.
4. Geef het account een herkenbare naam, bijvoorbeeld `jira-dashboard`.
5. Bewaar de automatisch toegewezen technische e-mail, bijvoorbeeld
   `jira-dashboard@serviceaccount.atlassian.com`.

### 2. Geef alleen de benodigde Jira-toegang

1. Geef het service account toegang tot Jira.
2. Voeg het toe aan de juiste projectrol in project `SD`, bijvoorbeeld een
   aparte rol `Dashboard reader`.
3. Geef die rol uitsluitend de rechten die de dashboardqueries nodig hebben:
   - **Browse projects**;
   - **View issues**;
   - toegang tot de velden die in de synchronisatie en KPI's worden gelezen.
4. Controleer met Jira's Permission Helper of het account een representatief
   ticket in `SD` mag bekijken.

Gebruik geen Jira-beheerderrol wanneer lezen voldoende is. Beperk toegang tot
andere projecten expliciet.

### 3. Maak een scoped API-token

1. Ga in Atlassian Administration naar **Directory → Service accounts**.
2. Open het service account en kies **Create credential**.
3. Kies **API token**.
4. Geef het token een doelgerichte naam, bijvoorbeeld
   `jira-dashboard-production`.
5. Kies een passende vervaldatum (maximaal 365 dagen).
6. Kies de minimale Jira-scope voor lezen: `read:jira-work`.
7. Maak het token aan en sla de getoonde waarde direct op in de
   secretopslag. Atlassian toont de tokenwaarde daarna niet opnieuw.

### 4. Pas de dashboardconfiguratie aan

Sla de volgende waarden uitsluitend als secrets op, bijvoorbeeld in `.env`
voor lokaal gebruik of in de secretopslag van productie:

```dotenv
JIRA_TOKEN=<nieuwe-token>
JIRA_PROJECT=SD
JIRA_CLOUD_ID=<cloud-id-van-de-jira-site>
JIRA_AUTH_MODE=service_account
```

Voeg `.env` nooit toe aan Git. Leg de tokenwaarde ook niet vast in tickets,
chatberichten of documentatie.

`JIRA_EMAIL` is niet nodig voor de service-accountmodus. Je mag de bestaande
waarde laten staan, maar deze wordt dan niet gebruikt.

> De dashboardcode gebruikt met `JIRA_AUTH_MODE=service_account` automatisch
> de Atlassian Platform API (`https://api.atlassian.com/ex/jira/{cloudId}/...`)
> met Bearer-authenticatie. `JIRA_BASE` blijft de URL van jullie Jira-site,
> zodat ticketlinks in het dashboard naar de juiste webpagina blijven wijzen.

### 5. Test vóór ingebruikname

1. Vraag met het service account het eigen profiel op via de Platform API.
2. Voer daarna een leesquery uit op project `SD`.
3. Controleer dat de synchronisatie en de live KPI's in het dashboard werken.
4. Controleer in de log dat er geen `401`, `403` of ontbrekende velden zijn.
5. Trek pas na een succesvolle productiecontrole de persoonlijke token in.

## Beheer en rotatie

- Registreer tokennaam, eigenaarsteam, aanmaakdatum en vervaldatum in de
  beheerregistratie; registreer nooit de tokenwaarde.
- Plan vervanging ruim voor de vervaldatum. Atlassian-tokens verlopen uiterlijk
  na één jaar.
- Maak bij rotatie eerst een nieuwe token, zet deze uit, test, en trek daarna
  de oude token in.
- Trek de token direct in bij een vermoeden van uitlekken.
- Beoordeel periodiek of de projectrechten en `read:jira-work` nog minimaal
  zijn.

## Problemen oplossen

| Symptoom | Waarschijnlijke oorzaak | Controle |
| --- | --- | --- |
| `401 Unauthorized` | Verkeerde endpointvorm, verlopen token of ongeldige authenticatie | Gebruik `api.atlassian.com/ex/jira/{cloudId}` voor de scoped token en controleer de vervaldatum. |
| `403` of ticket niet zichtbaar | Ontbrekende project- of issue-rechten | Controleer projectrol, Permission Helper en veldrechten. |
| `404` via Platform API | Organisatie-ID gebruikt in plaats van cloud ID | Gebruik het cloud ID van de Jira-site. |
| Niet alle velden worden gesynchroniseerd | Veld is niet zichtbaar voor het service account | Controleer scherm-, context- en veldrechten in Jira. |

## Bronnen

- [Atlassian – API-tokens voor service accounts beheren](https://support.atlassian.com/user-management/docs/manage-api-tokens-for-service-accounts/)
- [Atlassian – service accounts begrijpen](https://support.atlassian.com/user-management/docs/understand-service-accounts/)
- [Atlassian – API-tokens beheren](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)
