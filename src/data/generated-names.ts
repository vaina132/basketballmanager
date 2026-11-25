/**
 * Format 105 (owner data check, 24 November 2026): names and nationalities of generated people in new careers
 * (`world.generatedPeople`). Older careers keep `src/data/people-names.ts` and the invented academy and next-division
 * names exactly.
 *
 * Common first and last names of each name origin, combined into fictional people; no list is meant to name a real
 * person. A nationality reads its names from one origin (`NATIONALITY_ORIGINS`: Canada and Australia use the American
 * lists, Montenegro the Serbian ones, Brazil the Portuguese ones). Every origin's first x last combinations are read in
 * a fixed shuffle, and each kind of person (next-division players, academy prospects, draft prospects, coaches,
 * presidents) reads its own share of that shuffle, so two kinds never draw the same name; a name an earlier origin can
 * also make (accents and case aside) belongs to that origin only. Callers pass the names already in use and get the
 * first free one from a seeded start, so a world never holds one full name twice.
 *
 * Nationalities are spelled as the data pack spells them ("USA", "Bosnia and Herzegovina", "DR Congo"), so every one
 * has a flag in `src/data/country-flags.ts`.
 */
type NameList = { first: readonly string[]; last: readonly string[] };

const ORIGINS = {
  spain: {
    first: ['Alberto', 'Alejandro', 'Álvaro', 'Andrés', 'Antonio', 'Borja', 'Carlos', 'Daniel', 'David', 'Diego', 'Eduardo', 'Enrique', 'Fernando', 'Francisco', 'Gonzalo', 'Guillermo', 'Héctor', 'Ignacio', 'Iñaki', 'Javier', 'Jesús', 'Jordi', 'Jorge', 'José', 'Juan', 'Luis', 'Manuel', 'Marcos', 'Mario', 'Miguel', 'Óscar', 'Pablo', 'Pedro', 'Rafael', 'Ramón', 'Raúl', 'Rubén', 'Santiago', 'Sergio', 'Víctor',
      'Adrián', 'Agustín', 'Aitor', 'Alfonso', 'Alfredo', 'Ander', 'Ángel', 'Arturo', 'Asier', 'Bernardo', 'César', 'Cristian', 'Darío', 'Emilio', 'Ernesto', 'Esteban', 'Felipe', 'Gabriel', 'Gerard', 'Gorka', 'Hugo', 'Ibai', 'Iker', 'Isaac', 'Ismael', 'Iván', 'Jaime', 'Joan', 'Joaquín', 'Joel', 'Jon', 'Josep', 'Julián', 'Julio', 'Lorenzo', 'Lucas', 'Marc', 'Martín', 'Mateo', 'Mikel', 'Nacho', 'Nicolás', 'Oriol', 'Pau', 'Pol', 'Ricardo', 'Roberto', 'Rodrigo', 'Salvador', 'Samuel', 'Saúl', 'Simón', 'Tomás', 'Unai', 'Vicente', 'Xavier', 'Xabier', 'Álex', 'Bruno', 'Dani', 'Eric', 'Gerardo', 'Gustavo', 'Hernán', 'Leo'],
    last: ['García', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno', 'Muñoz', 'Álvarez', 'Romero', 'Alonso', 'Gutiérrez', 'Navarro', 'Torres', 'Domínguez', 'Vázquez', 'Ramos', 'Gil', 'Ramírez', 'Serrano', 'Blanco', 'Molina', 'Morales', 'Suárez', 'Ortega', 'Delgado', 'Castro', 'Ortiz', 'Rubio', 'Marín', 'Sanz', 'Iglesias',
      'Núñez', 'Medina', 'Garrido', 'Cortés', 'Castillo', 'Santos', 'Lozano', 'Guerrero', 'Cano', 'Prieto', 'Méndez', 'Cruz', 'Calvo', 'Gallego', 'Vidal', 'León', 'Márquez', 'Herrera', 'Peña', 'Flores', 'Cabrera', 'Campos', 'Vega', 'Fuentes', 'Carrasco', 'Díez', 'Caballero', 'Reyes', 'Nieto', 'Aguilar', 'Pascual', 'Santana', 'Herrero', 'Montero', 'Hidalgo', 'Giménez', 'Ibáñez', 'Ferrer', 'Durán', 'Benítez', 'Mora', 'Vargas', 'Arias', 'Carmona', 'Crespo', 'Román', 'Pastor', 'Soto', 'Sáez', 'Velasco', 'Moya', 'Soler', 'Parra', 'Esteban', 'Bravo', 'Gallardo', 'Rojas', 'Pardo', 'Merino', 'Franco', 'Espinosa', 'Izquierdo', 'Lara', 'Rivas', 'Rivera', 'Casado', 'Arroyo', 'Redondo', 'Camacho', 'Rey', 'Vera', 'Otero', 'Luque', 'Galán', 'Montes', 'Ríos', 'Sierra', 'Segura', 'Carrillo', 'Soriano', 'Mendoza', 'Robles', 'Bernal', 'Vila', 'Valero', 'Palacios', 'Pineda', 'Benito', 'Rincón', 'Aranda', 'Salas', 'Bermúdez', 'Contreras', 'Luna', 'Navas', 'Quintana', 'Cuesta', 'Valle', 'Mesa', 'Sola', 'Beltrán', 'Paredes', 'Oliva', 'Manzano', 'Echevarría', 'Aguirre', 'Zabala', 'Etxeberria', 'Llorente', 'Puig', 'Roca', 'Font', 'Costa', 'Pujol'],
  },
  turkey: {
    first: ['Ahmet', 'Ali', 'Alper', 'Anıl', 'Barış', 'Batuhan', 'Burak', 'Can', 'Cem', 'Cenk', 'Deniz', 'Emre', 'Engin', 'Erdem', 'Ergin', 'Erkan', 'Ersin', 'Fatih', 'Gökhan', 'Hakan', 'Hasan', 'Hüseyin', 'İbrahim', 'Kaan', 'Kerem', 'Koray', 'Mehmet', 'Murat', 'Mustafa', 'Okan', 'Onur', 'Orhan', 'Ozan', 'Selim', 'Serkan', 'Sinan', 'Tolga', 'Tuncay', 'Volkan', 'Yusuf',
      'Abdullah', 'Adem', 'Arda', 'Aykut', 'Baran', 'Berk', 'Berkay', 'Bora', 'Bülent', 'Caner', 'Cihan', 'Doğukan', 'Efe', 'Egemen', 'Emir', 'Enes', 'Eren', 'Erhan', 'Ertuğrul', 'Furkan', 'Gürkan', 'Halil', 'Harun', 'İlker', 'İsmail', 'Kadir', 'Kemal', 'Levent', 'Mahmut', 'Mert', 'Metin', 'Muhammed', 'Necati', 'Oğuz', 'Oğuzhan', 'Ömer', 'Önder', 'Osman', 'Recep', 'Rıdvan', 'Salih', 'Samet', 'Sarp', 'Semih', 'Sercan', 'Serdar', 'Sertaç', 'Süleyman', 'Taner', 'Tarık', 'Taylan', 'Uğur', 'Umut', 'Utku', 'Yasin', 'Yiğit', 'Yunus', 'Zafer', 'Alican', 'Ege', 'Erkam', 'Göktuğ', 'Kutay', 'Tuna'],
    last: ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Korkmaz', 'Karaca', 'Güneş', 'Aksoy', 'Tekin', 'Ünal', 'Akın', 'Bulut', 'Taş', 'Keskin', 'Avcı', 'Uçar', 'Toprak', 'Ateş', 'Turan', 'Güler', 'Sarı', 'Karakaya',
      'Acar', 'Akbaş', 'Akgül', 'Akkaya', 'Aktaş', 'Altun', 'Altıntaş', 'Arıkan', 'Atalay', 'Aydemir', 'Aydoğan', 'Bayram', 'Bozkurt', 'Cengiz', 'Coşkun', 'Çakır', 'Çakmak', 'Çiftçi', 'Demirci', 'Demirel', 'Dinç', 'Duman', 'Durmaz', 'Ergün', 'Erol', 'Gök', 'Gül', 'Gündoğdu', 'Gündüz', 'Gürbüz', 'Işık', 'Kahraman', 'Kalkan', 'Kaplan', 'Karaaslan', 'Karabulut', 'Karadağ', 'Karadeniz', 'Karakuş', 'Kartal', 'Kaymaz', 'Kocabaş', 'Kocaman', 'Konak', 'Kozan', 'Kuru', 'Mutlu', 'Oral', 'Oruç', 'Özbek', 'Özcan', 'Özer', 'Özyurt', 'Peker', 'Sağlam', 'Savaş', 'Sevim', 'Sezer', 'Soylu', 'Sönmez', 'Şen', 'Şener', 'Tanrıverdi', 'Taşkın', 'Temel', 'Tokgöz', 'Tosun', 'Tunç', 'Türkmen', 'Uysal', 'Uzun', 'Ünlü', 'Yalçın', 'Yaman', 'Yavuz', 'Yazıcı', 'Yener', 'Yetkin', 'Yücel', 'Yüksel', 'Zengin', 'Akdeniz', 'Albayrak', 'Alkan', 'Altay', 'Aras', 'Başaran', 'Battal', 'Berber', 'Bilgin', 'Bilgiç', 'Ceylan', 'Çınar', 'Dalkılıç', 'Ekinci', 'Elmas', 'Erbay', 'Erdoğdu', 'Gedik', 'Gümüş', 'Kalaycı', 'Kandemir', 'Kocabıyık', 'Ozan', 'Pala', 'Sarıkaya', 'Sungur', 'Tatlı', 'Topal', 'Usta', 'Varol'],
  },
  italy: {
    first: ['Alberto', 'Alessandro', 'Andrea', 'Antonio', 'Carlo', 'Claudio', 'Daniele', 'Dario', 'Davide', 'Diego', 'Emanuele', 'Enrico', 'Fabio', 'Federico', 'Filippo', 'Francesco', 'Gabriele', 'Giacomo', 'Gianluca', 'Giorgio', 'Giovanni', 'Giuseppe', 'Lorenzo', 'Luca', 'Marco', 'Massimo', 'Matteo', 'Maurizio', 'Michele', 'Nicola', 'Paolo', 'Pietro', 'Riccardo', 'Roberto', 'Salvatore', 'Simone', 'Stefano', 'Tommaso', 'Valerio', 'Vincenzo',
      'Achille', 'Aldo', 'Alessio', 'Alfredo', 'Angelo', 'Bruno', 'Cesare', 'Christian', 'Corrado', 'Cristiano', 'Domenico', 'Edoardo', 'Elia', 'Emilio', 'Ettore', 'Fabrizio', 'Fausto', 'Flavio', 'Franco', 'Gaetano', 'Giampaolo', 'Gianmarco', 'Gino', 'Giulio', 'Ivan', 'Jacopo', 'Leonardo', 'Luciano', 'Luigi', 'Manuel', 'Marcello', 'Mario', 'Mattia', 'Mauro', 'Mirko', 'Nicolò', 'Orlando', 'Pasquale', 'Piero', 'Raffaele', 'Renato', 'Rocco', 'Samuele', 'Sandro', 'Saverio', 'Sergio', 'Silvio', 'Umberto', 'Vittorio', 'Walter', 'Amedeo', 'Arturo', 'Carmine', 'Ernesto', 'Gianni', 'Guido', 'Lino', 'Ottavio', 'Ruggero', 'Tiziano', 'Alessandro', 'Diego', 'Michelangelo', 'Nico', 'Pierpaolo'],
    last: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile', 'Martinelli', 'Vitale', 'Lombardo', 'Serra', 'Coppola', 'De Santis', "D'Angelo", 'Marchetti',
      'Parisi', 'Villa', 'Conte', 'Ferraro', 'Ferri', 'Fabbri', 'Bianco', 'Marini', 'Grasso', 'Valentini', 'Messina', 'Sala', 'De Angelis', 'Gatti', 'Pellegrini', 'Palumbo', 'Sanna', 'Farina', 'Rizzi', 'Monti', 'Cattaneo', 'Morelli', 'Amato', 'Silvestri', 'Mazza', 'Testa', 'Grassi', 'Pellegrino', 'Carbone', 'Giuliani', 'Benedetti', 'Barone', 'Rossetti', 'Caputo', 'Montanari', 'Guerra', 'Palmieri', 'Bernardi', 'Martino', 'Fiore', 'De Rosa', 'Ferretti', 'Bellini', 'Basile', 'Riva', 'Donati', 'Piras', 'Vitali', 'Battaglia', 'Sartori', 'Neri', 'Costantini', 'Milani', 'Pagano', 'Ruggiero', 'Sorrentino', "D'Amico", 'Orlando', 'Negri', 'Mantovani', 'Bassi', 'Bertolini', 'Brambilla', 'Cavallo', 'Cirillo', 'Colonna', "D'Alessandro", 'De Simone', 'Di Stefano', 'Fumagalli', 'Giorgi', 'Iacono', 'Lanza', 'Leoni', 'Lupo', 'Magri', 'Marchi', 'Mele', 'Melis', 'Napolitano', 'Olivieri', 'Pace', 'Papa', 'Pastore', 'Poli', 'Porcu', 'Raimondi', 'Rota', 'Sacco', 'Santini', 'Scotti', 'Spinelli', 'Tedesco', 'Tosi', 'Valente', 'Venturi', 'Zanetti', 'Bonetti', 'Bonomi', 'Bruni', 'Calabrese', 'Capelli', 'Carli', 'Cocco', 'Corsi', 'Crippa', 'De Marco', 'Di Pietro', 'Fadda', 'Ferrante', 'Gallina', 'Lucchesi', 'Pozzi'],
  },
  france: {
    first: ['Alexandre', 'Antoine', 'Arnaud', 'Benoît', 'Bruno', 'Cédric', 'Christophe', 'Damien', 'David', 'Éric', 'Fabien', 'Florent', 'François', 'Frédéric', 'Grégory', 'Guillaume', 'Hugo', 'Jérôme', 'Julien', 'Laurent', 'Louis', 'Lucas', 'Marc', 'Mathieu', 'Maxime', 'Michel', 'Nicolas', 'Olivier', 'Pascal', 'Patrick', 'Philippe', 'Pierre', 'Quentin', 'Romain', 'Sébastien', 'Stéphane', 'Thierry', 'Thomas', 'Vincent', 'Yannick',
      'Adrien', 'Alain', 'Anthony', 'Aurélien', 'Axel', 'Baptiste', 'Bastien', 'Benjamin', 'Bertrand', 'Clément', 'Corentin', 'Cyril', 'Denis', 'Didier', 'Dylan', 'Emmanuel', 'Enzo', 'Étienne', 'Florian', 'Franck', 'Gaël', 'Gaëtan', 'Gilles', 'Hervé', 'Jean', 'Jérémy', 'Jonathan', 'Jordan', 'Kévin', 'Killian', 'Léo', 'Loïc', 'Ludovic', 'Malik', 'Mehdi', 'Mickaël', 'Nathan', 'Noah', 'Paul', 'Raphaël', 'Rémi', 'Sacha', 'Samuel', 'Simon', 'Sylvain', 'Théo', 'Timothée', 'Tristan', 'Valentin', 'Victor', 'Xavier', 'Yann', 'Yohan', 'Amine', 'Moussa', 'Ibrahim', 'Karim', 'Rudy', 'Evan', 'Joffrey', 'Mamadou', 'Ousmane', 'Rémy', 'Sékou'],
    last: ['Martin', 'Bernard', 'Dubois', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Lefebvre', 'Bertrand', 'Roux', 'Fournier', 'Morel', 'Girard', 'André', 'Lefèvre', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'Legrand', 'Garnier', 'Faure', 'Rousseau', 'Blanc', 'Guérin', 'Muller', 'Henry', 'Roussel', 'Perrin', 'Morin', 'Mathieu', 'Clément', 'Gauthier', 'Chevalier', 'Masson', 'Denis',
      'Laurent', 'Michel', 'David', 'Thomas', 'Lemaire', 'Duval', 'Joly', 'Gautier', 'Roger', 'Roche', 'Roy', 'Noël', 'Meyer', 'Lucas', 'Meunier', 'Marchand', 'Dufour', 'Blanchard', 'Gaillard', 'Barbier', 'Arnaud', 'Gérard', 'Brun', 'Picard', 'Fontaine', 'Caron', 'Lemoine', 'Leclerc', 'Renaud', 'Brunet', 'Aubert', 'Colin', 'Lacroix', 'Renard', 'Leclercq', 'Giraud', 'Schmitt', 'Rolland', 'Vincent', 'Bourgeois', 'Dumas', 'Huet', 'Fabre', 'Boyer', 'Moulin', 'Collet', 'Hubert', 'Poirier', 'Benoît', 'Carpentier', 'Charpentier', 'Baron', 'Bouvier', 'Germain', 'Lebrun', 'Langlois', 'Bailly', 'Leblanc', 'Guillot', 'Prévost', 'Hamon', 'Cordier', 'Royer', 'Diallo', 'Traoré', 'Camara', 'Koné', 'Diop', 'Fofana', 'Sylla', 'Cissé', 'Konaté', 'Touré', 'Ndiaye', 'Mendy', 'Gomis', 'Sow', 'Keita', 'Doucouré', 'Coulibaly', 'Sissoko', 'Kanté', 'Diakité', 'Boucher', 'Lemaître', 'Millet', 'Marty', 'Besson', 'Vasseur', 'Tessier', 'Delmas', 'Pierre', 'Jacquet', 'Rey', 'Lopes', 'Tanguy', 'Bouchet', 'Hoarau', 'Pinto', 'Lebreton', 'Olivier', 'Maillard'],
  },
  greece: {
    first: ['Alexandros', 'Andreas', 'Angelos', 'Antonis', 'Apostolos', 'Aris', 'Babis', 'Christos', 'Dimitris', 'Dionysis', 'Fotis', 'Georgios', 'Giannis', 'Grigoris', 'Ilias', 'Konstantinos', 'Kostas', 'Kyriakos', 'Lambros', 'Lefteris', 'Manolis', 'Markos', 'Michalis', 'Nektarios', 'Nikos', 'Panagiotis', 'Pavlos', 'Petros', 'Sotiris', 'Spyros', 'Stavros', 'Stelios', 'Stratos', 'Tasos', 'Thanasis', 'Theodoros', 'Thodoris', 'Vangelis', 'Vasilis', 'Zisis',
      'Achilleas', 'Adonis', 'Agis', 'Alkiviadis', 'Anastasios', 'Antonios', 'Argyris', 'Aristotelis', 'Charalampos', 'Christoforos', 'Dimosthenis', 'Efstathios', 'Emmanouil', 'Evangelos', 'Filippos', 'Fotios', 'Gerasimos', 'Iason', 'Ioannis', 'Iraklis', 'Kleanthis', 'Kosmas', 'Leonidas', 'Loukas', 'Marios', 'Matthaios', 'Miltiadis', 'Minas', 'Nikolaos', 'Odysseas', 'Orestis', 'Pantelis', 'Paraskevas', 'Periklis', 'Prodromos', 'Rafail', 'Savvas', 'Serafeim', 'Sokratis', 'Stamatis', 'Stefanos', 'Stergios', 'Thanos', 'Themistoklis', 'Timos', 'Triantafyllos', 'Vyron', 'Xenofon', 'Zacharias', 'Panos', 'Takis', 'Kostis', 'Dimos', 'Lazaros', 'Nestoras', 'Chrysostomos', 'Eleftherios', 'Ermis', 'Haris', 'Lysandros', 'Neoklis', 'Platon', 'Thrasyvoulos', 'Yiannis'],
    last: ['Papadopoulos', 'Papadakis', 'Georgiou', 'Nikolaou', 'Papanikolaou', 'Oikonomou', 'Dimitriou', 'Konstantinidis', 'Vlachos', 'Karagiannis', 'Pappas', 'Makris', 'Ioannidis', 'Christodoulou', 'Athanasiou', 'Antoniou', 'Alexiou', 'Triantafyllou', 'Mavridis', 'Theodorou', 'Kyriakidis', 'Michailidis', 'Panagiotopoulos', 'Stavrou', 'Lazaridis', 'Angelopoulos', 'Kotsis', 'Galanis', 'Sotiropoulos', 'Tsakalidis', 'Diamantidis', 'Karalis', 'Zervas', 'Marinos', 'Raptis', 'Fotiou', 'Chatzis', 'Spanos', 'Petridis', 'Vasileiou',
      'Anagnostou', 'Andreou', 'Apostolou', 'Argyropoulos', 'Bakas', 'Charalampidis', 'Chatzidakis', 'Christakis', 'Dimitrakopoulos', 'Doukas', 'Efthymiou', 'Evangelou', 'Floros', 'Frangos', 'Georgakopoulos', 'Gerakis', 'Giannakopoulos', 'Giannopoulos', 'Gkikas', 'Iliopoulos', 'Kalogeropoulos', 'Kanellopoulos', 'Karras', 'Katsaros', 'Kefalas', 'Kokkinos', 'Kolovos', 'Kondylis', 'Kostopoulos', 'Koutsoukos', 'Kyriakou', 'Lambropoulos', 'Lekkas', 'Liakos', 'Manolopoulos', 'Margaritis', 'Mavros', 'Melas', 'Michalopoulos', 'Mitropoulos', 'Moraitis', 'Nikolopoulos', 'Ntinos', 'Pantazis', 'Papachristou', 'Papadimitriou', 'Papageorgiou', 'Papaioannou', 'Papathanasiou', 'Papazoglou', 'Paraskevopoulos', 'Pavlidis', 'Petropoulos', 'Politis', 'Psaltis', 'Rallis', 'Rigas', 'Sarris', 'Sideris', 'Skouras', 'Spyropoulos', 'Stamatopoulos', 'Stathopoulos', 'Stefanidis', 'Tsakiris', 'Tsoukalas', 'Vasilakis', 'Vlachopoulos', 'Voulgaris', 'Xanthopoulos', 'Zafeiriou', 'Christou', 'Konstantinou', 'Manousakis', 'Markou', 'Mylonas', 'Nikas', 'Panagiotou', 'Perakis', 'Sotiriou', 'Stavropoulos', 'Theodoropoulos', 'Tzanetakis', 'Vlachakis', 'Zografos', 'Antonopoulos', 'Athanasopoulos', 'Bouras', 'Dimopoulos', 'Drakos', 'Gavalas', 'Kapetanakis', 'Kouris', 'Laskaris', 'Maragkos', 'Moschos', 'Daskalakis', 'Kalaitzis', 'Lykos', 'Pachis', 'Roussos', 'Siamos', 'Tsirigotis'],
  },
  germany: {
    first: ['Alexander', 'Andreas', 'Benjamin', 'Bernd', 'Christian', 'Daniel', 'Dennis', 'Dirk', 'Fabian', 'Felix', 'Florian', 'Frank', 'Henrik', 'Jan', 'Jens', 'Johannes', 'Jonas', 'Julian', 'Kai', 'Klaus', 'Lars', 'Lukas', 'Marco', 'Markus', 'Martin', 'Matthias', 'Maximilian', 'Michael', 'Moritz', 'Niklas', 'Oliver', 'Patrick', 'Peter', 'Philipp', 'Ralf', 'Sebastian', 'Stefan', 'Thomas', 'Tobias', 'Uwe',
      'Achim', 'Adrian', 'André', 'Arne', 'Bastian', 'Ben', 'Björn', 'Carsten', 'Christoph', 'David', 'Dominik', 'Elias', 'Erik', 'Finn', 'Frederik', 'Georg', 'Gerrit', 'Hannes', 'Heiko', 'Holger', 'Ingo', 'Jakob', 'Jannik', 'Joachim', 'Jochen', 'Jörg', 'Jürgen', 'Kevin', 'Konstantin', 'Leon', 'Lennart', 'Linus', 'Luca', 'Malte', 'Manuel', 'Marcel', 'Marius', 'Mario', 'Mats', 'Max', 'Nico', 'Nils', 'Noah', 'Ole', 'Paul', 'Pascal', 'Robin', 'Rolf', 'Sascha', 'Simon', 'Steffen', 'Sven', 'Till', 'Tim', 'Timo', 'Torsten', 'Volker', 'Wolfgang', 'Yannick', 'Anton', 'Hendrik', 'Karsten', 'Oskar', 'Henning', 'Tom', 'Vincent', 'Julius'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Schäfer', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Hartmann', 'Lange', 'Schmitt', 'Werner', 'Schmitz', 'Krause', 'Meier', 'Lehmann', 'Schmid', 'Schulze', 'Maier', 'Köhler', 'Herrmann', 'König', 'Walter', 'Mayer', 'Huber',
      'Schulte', 'Krämer', 'Vogel', 'Stein', 'Jäger', 'Otto', 'Sommer', 'Groß', 'Seidel', 'Heinrich', 'Brandt', 'Haas', 'Schreiber', 'Graf', 'Dietrich', 'Ziegler', 'Kuhn', 'Kühn', 'Pohl', 'Engel', 'Horn', 'Busch', 'Bergmann', 'Voigt', 'Sauer', 'Arnold', 'Wolff', 'Pfeiffer', 'Lorenz', 'Ludwig', 'Hahn', 'Schubert', 'Winkler', 'Roth', 'Beck', 'Lindner', 'Böhm', 'Kraus', 'Albrecht', 'Franke', 'Winter', 'Schuster', 'Fuchs', 'Vogt', 'Jung', 'Keller', 'Günther', 'Berger', 'Friedrich', 'Peters', 'Lang', 'Weiß', 'Möller', 'Schumacher', 'Kaiser', 'Thiele', 'Böttcher', 'Schütz', 'Ernst', 'Kraft', 'Brinkmann', 'Hartwig', 'Kremer', 'Janssen', 'Lindemann', 'Marx', 'Petersen', 'Reuter', 'Rieger', 'Ritter', 'Seifert', 'Stark', 'Thiel', 'Ulrich', 'Walther', 'Wendt', 'Wenzel', 'Wiese', 'Wilhelm', 'Witt', 'Zimmer', 'Kolb', 'Lehner', 'Bock', 'Heinz', 'Kuhlmann', 'Mertens', 'Moser', 'Nagel', 'Oswald', 'Paulsen', 'Rademacher', 'Rösler', 'Sander', 'Schramm', 'Siebert', 'Thomsen', 'Vetter', 'Wirth', 'Hansen', 'Kirchner', 'Schröter', 'Lux', 'Baumann', 'Dittrich', 'Gebhardt', 'Hesse', 'Kunz', 'Probst', 'Rupp', 'Stahl'],
  },
  usa: {
    first: ['Aaron', 'Adam', 'Alex', 'Andre', 'Andrew', 'Anthony', 'Austin', 'Ben', 'Blake', 'Brandon', 'Brian', 'Bryce', 'Caleb', 'Cameron', 'Chris', 'Christian', 'Cody', 'Cole', 'Collin', 'Connor', 'Corey', 'Damian', 'Darius', 'Darnell', 'DeAndre', 'Demetrius', 'Derek', 'Derrick', 'Devin', 'Devon', 'Dominique', 'Donovan', 'Dwayne', 'Dylan', 'Elijah', 'Eric', 'Ethan', 'Evan', 'Gabriel', 'Garrett',
      'Grant', 'Greg', 'Hunter', 'Isaiah', 'Jabari', 'Jackson', 'Jalen', 'Jamal', 'Jamar', 'James', 'Jared', 'Jason', 'Javon', 'Jaylen', 'Jeff', 'Jeremiah', 'Jermaine', 'Jerome', 'John', 'Jonathan', 'Jordan', 'Josh', 'Josiah', 'Julian', 'Justin', 'Kameron', 'Keith', 'Kendall', 'Kendrick', 'Kenny', 'Kevin', 'Khalil', 'Kyle', 'Lamar', 'Lance', 'Landon', 'Logan', 'Malcolm', 'Malik', 'Marcus', 'Mark', 'Marquis', 'Matt', 'Maurice', 'Max', 'Michael', 'Mike', 'Miles', 'Myles', 'Nate', 'Nick', 'Noah', 'Omar', 'Patrick', 'Quentin', 'Reggie', 'Ryan', 'Scott', 'Sean', 'Shawn', 'Spencer', 'Terrell', 'Terrence', 'Travis', 'Trevor', 'Tre', 'Tyler', 'Tyrese', 'Tyrone', 'Victor', 'Xavier', 'Zach', 'Desmond', 'Cedric', 'Damon', 'Deshawn', 'Tony', 'Paul', 'Tim', 'Steve', 'Brett', 'Carter', 'Chase', 'Colby', 'Darren', 'Isaac', 'Jaden', 'Keon', 'Luke', 'Tristan'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Robinson', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell', 'Mitchell', 'Roberts', 'Carter', 'Phillips', 'Evans', 'Turner', 'Parker',
      'Collins', 'Edwards', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Morgan', 'Cooper', 'Peterson', 'Reed', 'Bailey', 'Bell', 'Kelly', 'Howard', 'Ward', 'Cox', 'Richardson', 'Wood', 'Watson', 'Brooks', 'Bennett', 'Gray', 'James', 'Hughes', 'Price', 'Sanders', 'Myers', 'Long', 'Ross', 'Foster', 'Powell', 'Jenkins', 'Perry', 'Russell', 'Sullivan', 'Butler', 'Barnes', 'Fisher', 'Henderson', 'Coleman', 'Simmons', 'Patterson', 'Jordan', 'Reynolds', 'Hamilton', 'Graham', 'Wallace', 'Woods', 'Cole', 'West', 'Owens', 'Marshall', 'Harrison', 'Gibson', 'Ellis', 'McDonald', 'Bryant', 'Ford', 'Stevens', 'Tucker', 'Porter', 'Hunter', 'Hicks', 'Crawford', 'Henry', 'Boyd', 'Mason', 'Kennedy', 'Warren', 'Dixon', 'Burns', 'Gordon', 'Shaw', 'Holmes', 'Rice', 'Robertson', 'Hunt', 'Black', 'Daniels', 'Palmer', 'Mills', 'Grant', 'Knight', 'Ferguson', 'Stone', 'Hawkins', 'Dunn', 'Perkins', 'Hudson', 'Spencer', 'Stephens', 'Pierce', 'Hayes', 'Wells', 'Freeman', 'Webb', 'Washington', 'Lawrence', 'Weaver', 'Carroll', 'Austin', 'Fowler', 'Chambers', 'Greene', 'Lane', 'Moss', 'Payne', 'Pittman', 'Riley', 'Sims', 'Snyder', 'Thornton', 'Walton', 'Wheeler', 'Banks', 'Bates', 'Booker', 'Bowen', 'Bradley', 'Brewer', 'Caldwell', 'Cannon', 'Carr', 'Coates', 'Drummond', 'Fleming', 'Floyd', 'Frazier', 'Gaines', 'Garrett', 'Gilbert', 'Goodwin', 'Hardy', 'Harper', 'Hart', 'Hopkins', 'Ingram', 'Jefferson', 'Lyons', 'Mack', 'Mathis', 'McCoy', 'Merritt', 'Newton', 'Norris', 'Pope', 'Ray', 'Rhodes', 'Simpson', 'Stokes', 'Terry', 'Vaughn', 'Watts'],
  },
  serbia: {
    first: ['Aleksandar', 'Bogdan', 'Boris', 'Branko', 'Darko', 'Dejan', 'Dragan', 'Dušan', 'Goran', 'Igor', 'Ivan', 'Marko', 'Milan', 'Miloš', 'Miroslav', 'Nemanja', 'Nenad', 'Nikola', 'Predrag', 'Radomir', 'Saša', 'Slobodan', 'Srđan', 'Stefan', 'Vladimir', 'Zoran', 'Aleksa', 'Andrija', 'Balša', 'Bojan', 'Danilo', 'Đorđe', 'Filip', 'Lazar', 'Luka', 'Mihajlo', 'Milutin', 'Ognjen', 'Petar', 'Uroš', 'Vasilije', 'Veljko', 'Vuk', 'Žarko', 'Strahinja'],
    last: ['Jovanović', 'Petrović', 'Nikolić', 'Marković', 'Đorđević', 'Stojanović', 'Ilić', 'Stanković', 'Pavlović', 'Milošević', 'Popović', 'Đukić', 'Kovačević', 'Lazić', 'Obradović', 'Radović', 'Simić', 'Tomić', 'Vasić', 'Živković', 'Mitrović', 'Janković', 'Savić', 'Todorović', 'Ristić', 'Vuković', 'Bulatović', 'Đurović', 'Perović', 'Lekić', 'Ivanović', 'Radulović', 'Vujović', 'Bošković', 'Milić', 'Kostić', 'Pešić', 'Lukić', 'Gajić', 'Matić', 'Jeremić', 'Ivković', 'Milovanović', 'Stefanović', 'Mladenović', 'Antić', 'Babović', 'Knežević', 'Radonjić', 'Šćepanović'],
  },
  croatia: {
    first: ['Ante', 'Damir', 'Dario', 'Davor', 'Domagoj', 'Filip', 'Hrvoje', 'Igor', 'Ivan', 'Ivica', 'Josip', 'Krešimir', 'Luka', 'Marin', 'Mario', 'Matej', 'Mislav', 'Neven', 'Nikola', 'Petar', 'Robert', 'Tomislav', 'Vedran', 'Zdravko', 'Zvonimir', 'Bruno', 'Dino', 'Fran', 'Jakov', 'Karlo', 'Lovro', 'Marko', 'Roko', 'Šime', 'Toni', 'Dominik', 'Mateo', 'Duje', 'Goran', 'Stipe'],
    last: ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Novak', 'Knežević', 'Vuković', 'Marković', 'Petrović', 'Matić', 'Tomić', 'Pavlović', 'Božić', 'Blažević', 'Grgić', 'Perić', 'Barišić', 'Šarić', 'Lovrić', 'Vidović', 'Pavić', 'Radić', 'Kolar', 'Galić', 'Bošnjak', 'Ćosić', 'Jukić', 'Kovač', 'Matijević', 'Ivanković', 'Šimić', 'Jelić', 'Rukavina', 'Brkić', 'Mandić', 'Pranjić', 'Petković', 'Lončar', 'Bilić', 'Filipović', 'Antunović', 'Vrdoljak', 'Šimunović', 'Tadić'],
  },
  slovenia: {
    first: ['Aleš', 'Andrej', 'Blaž', 'Boštjan', 'Domen', 'Gašper', 'Gregor', 'Jaka', 'Jan', 'Janez', 'Jure', 'Klemen', 'Luka', 'Marko', 'Matej', 'Matjaž', 'Miha', 'Nejc', 'Primož', 'Rok', 'Simon', 'Tadej', 'Tilen', 'Uroš', 'Žiga', 'Alen', 'Anže', 'Bor', 'Erik', 'Lan', 'Mitja', 'Nik', 'Samo', 'Urban', 'Vid'],
    last: ['Novak', 'Horvat', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik', 'Kovač', 'Mlakar', 'Kos', 'Vidmar', 'Golob', 'Turk', 'Kralj', 'Zupan', 'Bizjak', 'Hribar', 'Korošec', 'Rozman', 'Petek', 'Kastelic', 'Oblak', 'Žagar', 'Hočevar', 'Kolenc', 'Košir', 'Koren', 'Kranjc', 'Mevlja', 'Pavlin', 'Rupnik', 'Sever', 'Vovk', 'Zorko', 'Lesjak', 'Murn', 'Jereb', 'Kavčič', 'Gorenc', 'Bajc', 'Medved'],
  },
  bosnia: {
    first: ['Amar', 'Emir', 'Adnan', 'Kenan', 'Haris', 'Mirza', 'Nedim', 'Dženan', 'Almir', 'Edin', 'Adin', 'Alen', 'Armin', 'Benjamin', 'Damir', 'Elvir', 'Ermin', 'Faruk', 'Jasmin', 'Kemal', 'Muhamed', 'Nihad', 'Samir', 'Tarik', 'Vedad', 'Zlatan', 'Senad', 'Anel', 'Eldin', 'Harun', 'Ismet', 'Selmir'],
    last: ['Hodžić', 'Hadžić', 'Begić', 'Mehmedović', 'Delić', 'Suljić', 'Omerović', 'Hasanović', 'Husić', 'Ibrahimović', 'Alić', 'Bašić', 'Čolić', 'Dedić', 'Halilović', 'Imamović', 'Jusić', 'Karić', 'Kurtović', 'Mujić', 'Osmanović', 'Salihović', 'Smajić', 'Softić', 'Šehić', 'Zukić', 'Avdić', 'Bećirović', 'Hrustanović', 'Mušić', 'Nurkić', 'Topić', 'Vilić', 'Džafić', 'Muratović'],
  },
  lithuania: {
    first: ['Andrius', 'Arvydas', 'Darius', 'Dainius', 'Donatas', 'Gediminas', 'Giedrius', 'Jonas', 'Kęstutis', 'Linas', 'Mantas', 'Marius', 'Mindaugas', 'Paulius', 'Rimantas', 'Robertas', 'Rokas', 'Saulius', 'Šarūnas', 'Tadas', 'Tomas', 'Vaidas', 'Valdas', 'Vytautas', 'Žydrūnas', 'Arnas', 'Augustas', 'Deividas', 'Domantas', 'Edgaras', 'Ignas', 'Justas', 'Kristupas', 'Laurynas', 'Lukas', 'Martynas', 'Matas', 'Nojus', 'Simas', 'Ovidijus'],
    last: ['Kazlauskas', 'Jankauskas', 'Petrauskas', 'Stankevičius', 'Vasiliauskas', 'Žukauskas', 'Butkus', 'Paulauskas', 'Urbonas', 'Kavaliauskas', 'Balčiūnas', 'Navickas', 'Rimkus', 'Mockus', 'Lukošius', 'Adomaitis', 'Jonaitis', 'Kairys', 'Kubilius', 'Valančius', 'Šimkus', 'Ramanauskas', 'Stonkus', 'Bagdonas', 'Vaitkus', 'Žilinskas', 'Sakalauskas', 'Kazakevičius', 'Žemaitis', 'Pocius', 'Lukoševičius', 'Gudaitis', 'Malinauskas', 'Kurlavičius', 'Vaičiulis', 'Bružas', 'Norkus', 'Šukys', 'Vilkas', 'Barkauskas', 'Ivanauskas', 'Mikalauskas', 'Rutkauskas', 'Tamošaitis', 'Daukša'],
  },
  latvia: {
    first: ['Jānis', 'Andris', 'Mārtiņš', 'Kristaps', 'Artūrs', 'Rihards', 'Edgars', 'Dāvis', 'Roberts', 'Kārlis', 'Raimonds', 'Uldis', 'Aigars', 'Aleksejs', 'Anžejs', 'Dairis', 'Ernests', 'Gatis', 'Haralds', 'Ingus', 'Kaspars', 'Klāvs', 'Mareks', 'Mārcis', 'Normunds', 'Oskars', 'Reinis', 'Rolands', 'Toms', 'Valters'],
    last: ['Bērziņš', 'Kalniņš', 'Ozols', 'Jansons', 'Liepiņš', 'Krūmiņš', 'Balodis', 'Zariņš', 'Pētersons', 'Vītols', 'Kļaviņš', 'Lācis', 'Eglītis', 'Siliņš', 'Freimanis', 'Zālītis', 'Šmits', 'Sproģis', 'Avotiņš', 'Jēkabsons', 'Kronbergs', 'Grīnbergs', 'Kalējs', 'Lūsis', 'Mežulis', 'Ozoliņš', 'Priedītis', 'Rudzītis', 'Skuja', 'Vanags', 'Zvirbulis', 'Celmiņš', 'Dombrovskis', 'Krastiņš', 'Āboliņš'],
  },
  poland: {
    first: ['Adam', 'Andrzej', 'Bartosz', 'Damian', 'Dariusz', 'Grzegorz', 'Jakub', 'Jan', 'Kamil', 'Krzysztof', 'Łukasz', 'Maciej', 'Marcin', 'Marek', 'Mateusz', 'Michał', 'Paweł', 'Piotr', 'Przemysław', 'Rafał', 'Robert', 'Sebastian', 'Szymon', 'Tomasz', 'Wojciech', 'Adrian', 'Aleksander', 'Dawid', 'Filip', 'Hubert', 'Igor', 'Kacper', 'Karol', 'Konrad', 'Mikołaj', 'Oskar', 'Patryk', 'Wiktor'],
    last: ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Kwiatkowski', 'Krawczyk', 'Piotrowski', 'Grabowski', 'Nowakowski', 'Pawłowski', 'Michalski', 'Nowicki', 'Adamczyk', 'Dudek', 'Zając', 'Wieczorek', 'Jabłoński', 'Król', 'Majewski', 'Olszewski', 'Jaworski', 'Wróbel', 'Malinowski', 'Pawlak', 'Witkowski', 'Walczak', 'Stępień', 'Górski', 'Rutkowski', 'Michalak'],
  },
  israel: {
    first: ['Amit', 'Ariel', 'Avi', 'Dan', 'Doron', 'Eitan', 'Eli', 'Erez', 'Gal', 'Guy', 'Ido', 'Itay', 'Lior', 'Meir', 'Moshe', 'Nadav', 'Oded', 'Ofer', 'Omri', 'Ori', 'Ran', 'Ronen', 'Shai', 'Tal', 'Yaniv', 'Yossi', 'Alon', 'Amir', 'Asaf', 'Barak', 'Elad', 'Gilad', 'Noam', 'Roy', 'Tomer', 'Yoav', 'Yuval', 'Ziv'],
    last: ['Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Friedman', 'Avraham', 'Dahan', 'Azoulay', 'Katz', 'Malka', 'Shapiro', 'Golan', 'Ben-David', 'Carmeli', 'Shalom', 'Hadad', 'Gabay', 'Segal', 'Amar', 'Ohana', 'Rosen', 'Weiss', 'Elkayam', 'Ashkenazi', 'Ben-Haim', 'Mor', 'Navon', 'Oren', 'Shemesh', 'Tzur', 'Yosef', 'Zilber', 'Halperin', 'Klein', 'Livne', 'Sasson', 'Vaknin'],
  },
  georgia: {
    first: ['Giorgi', 'Levan', 'Nika', 'Davit', 'Irakli', 'Luka', 'Sandro', 'Zurab', 'Lasha', 'Beka', 'Tornike', 'Otar', 'Aleksandre', 'Duda', 'Goga', 'Lado', 'Mikheil', 'Nikoloz', 'Revaz', 'Shota', 'Tengiz', 'Vakhtang', 'Zviad', 'Archil', 'Gia', 'Saba'],
    last: ['Beridze', 'Kapanadze', 'Gelashvili', 'Lomidze', 'Mamaladze', 'Tsiklauri', 'Bolkvadze', 'Japaridze', 'Abuladze', 'Bitadze', 'Gogoladze', 'Jorjadze', 'Kakhidze', 'Khutsishvili', 'Maisuradze', 'Mchedlidze', 'Nozadze', 'Shengelia', 'Tsertsvadze', 'Zhvania', 'Gigauri', 'Kalandadze', 'Mamukelashvili', 'Sanadze', 'Tskitishvili', 'Chikvaidze', 'Dvalishvili', 'Gvasalia'],
  },
  ukraine: {
    first: ['Oleksandr', 'Andriy', 'Dmytro', 'Serhiy', 'Ivan', 'Maksym', 'Yuriy', 'Viktor', 'Bohdan', 'Taras', 'Oleh', 'Vitaliy', 'Artem', 'Denys', 'Ihor', 'Kyrylo', 'Mykola', 'Mykhailo', 'Pavlo', 'Roman', 'Ruslan', 'Vadym', 'Volodymyr', 'Yaroslav', 'Anatoliy', 'Vyacheslav', 'Stanislav', 'Nazar'],
    last: ['Shevchenko', 'Kovalenko', 'Bondarenko', 'Tkachenko', 'Kravchenko', 'Oliynyk', 'Melnyk', 'Boyko', 'Moroz', 'Lysenko', 'Marchenko', 'Rudenko', 'Savchenko', 'Petrenko', 'Ponomarenko', 'Kovalchuk', 'Polishchuk', 'Shevchuk', 'Tkachuk', 'Hrytsenko', 'Kuzmenko', 'Pavlenko', 'Zinchenko', 'Lytvynenko', 'Sydorenko', 'Klymenko', 'Ivanenko', 'Yatsenko', 'Fedorenko', 'Karpenko'],
  },
  czech: {
    first: ['Jan', 'Jakub', 'Tomáš', 'Martin', 'Lukáš', 'Ondřej', 'Petr', 'Pavel', 'Josef', 'David', 'Jiří', 'Michal', 'Vojtěch', 'Filip', 'Adam', 'Matěj', 'Daniel', 'Marek', 'Radek', 'Vít', 'Zdeněk', 'Karel', 'Štěpán', 'Patrik', 'Viktor', 'Dominik', 'Šimon', 'Richard', 'Roman', 'Václav'],
    last: ['Novák', 'Svoboda', 'Novotný', 'Dvořák', 'Černý', 'Procházka', 'Kučera', 'Veselý', 'Horák', 'Němec', 'Pokorný', 'Marek', 'Pospíšil', 'Hájek', 'Jelínek', 'Král', 'Růžička', 'Beneš', 'Fiala', 'Sedláček', 'Doležal', 'Zeman', 'Kolář', 'Navrátil', 'Čermák', 'Vaněk', 'Urban', 'Blažek', 'Kříž', 'Kovář', 'Bartoš', 'Vlček', 'Polák', 'Musil', 'Kopecký'],
  },
  netherlands: {
    first: ['Jan', 'Pieter', 'Bas', 'Thijs', 'Joost', 'Ruben', 'Daan', 'Sven', 'Niels', 'Bram', 'Koen', 'Jeroen', 'Joris', 'Lars', 'Maarten', 'Martijn', 'Mitchell', 'Rick', 'Roel', 'Sander', 'Stijn', 'Tim', 'Wouter', 'Jesse', 'Luuk', 'Sem', 'Teun', 'Thomas', 'Floris', 'Gijs'],
    last: ['de Jong', 'Jansen', 'de Vries', 'van den Berg', 'van Dijk', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Dekker', 'Brouwer', 'de Wit', 'Dijkstra', 'Smits', 'de Graaf', 'van der Meer', 'van der Linden', 'Kok', 'Jacobs', 'de Haan', 'Vermeulen', 'van den Heuvel', 'van der Veen', 'van den Broek', 'de Bruijn', 'Schouten', 'Willems'],
  },
  belgium: {
    first: ['Bart', 'Benoît', 'Cédric', 'Didier', 'Dirk', 'Geert', 'Jan', 'Jean', 'Joris', 'Koen', 'Kris', 'Laurent', 'Lieven', 'Luc', 'Maarten', 'Nico', 'Olivier', 'Pieter', 'Sébastien', 'Steven', 'Stijn', 'Thibault', 'Tom', 'Wim', 'Yves', 'Arne', 'Brecht', 'Jens', 'Jonas', 'Kobe', 'Seppe', 'Wout', 'Toon', 'Ward'],
    last: ['Peeters', 'Janssens', 'Maes', 'Jacobs', 'Mertens', 'Willems', 'Claes', 'Goossens', 'Wouters', 'De Smet', 'Dubois', 'Lambert', 'Dupont', 'Vermeulen', 'Van den Broeck', 'Hermans', 'Desmet', 'Michiels', 'Leclercq', 'Martens', 'Pauwels', 'Van Damme', 'De Clercq', 'Verhoeven', 'Smets', 'De Backer', 'Van Hoof', 'Verstraete', 'Vandenberghe', 'Coppens', 'Lemmens', 'Aerts', 'Segers', 'Thys', 'Van Rossom'],
  },
  nordic: {
    first: ['Erik', 'Lars', 'Anders', 'Johan', 'Karl', 'Per', 'Mikael', 'Fredrik', 'Oskar', 'Viktor', 'Jonas', 'Henrik', 'Mikkel', 'Rasmus', 'Magnus', 'Emil', 'Gustav', 'Isak', 'Joakim', 'Kasper', 'Linus', 'Mattias', 'Nils', 'Olof', 'Sebastian', 'Simon', 'Tobias', 'Anton', 'Axel', 'Filip'],
    last: ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Gustafsson', 'Pettersson', 'Jonsson', 'Jensen', 'Nielsen', 'Hansen', 'Pedersen', 'Andersen', 'Christensen', 'Rasmussen', 'Lindberg', 'Lindqvist', 'Berg', 'Lund', 'Holm', 'Sandberg', 'Lindgren', 'Axelsson', 'Bergström', 'Engström', 'Dahl', 'Haugen', 'Johnsen'],
  },
  finland: {
    first: ['Mikko', 'Jukka', 'Timo', 'Antti', 'Juha', 'Ville', 'Sami', 'Petri', 'Janne', 'Lauri', 'Matti', 'Tuomas', 'Aleksi', 'Eetu', 'Elias', 'Henri', 'Joonas', 'Juho', 'Kalle', 'Miro', 'Niko', 'Olli', 'Onni', 'Otto', 'Teemu', 'Topias', 'Valtteri', 'Veikko'],
    last: ['Korhonen', 'Virtanen', 'Mäkinen', 'Nieminen', 'Mäkelä', 'Hämäläinen', 'Laine', 'Heikkinen', 'Koskinen', 'Järvinen', 'Lehtonen', 'Lehtinen', 'Saarinen', 'Salminen', 'Heinonen', 'Niemi', 'Heikkilä', 'Kinnunen', 'Salonen', 'Turunen', 'Salo', 'Laitinen', 'Tuominen', 'Rantanen', 'Karjalainen', 'Jokinen', 'Mattila', 'Savolainen', 'Lahtinen', 'Ahonen'],
  },
  portugal: {
    first: ['João', 'Pedro', 'Tiago', 'Miguel', 'Rui', 'Nuno', 'André', 'Ricardo', 'Diogo', 'Bruno', 'Hugo', 'Paulo', 'Rafael', 'Gustavo', 'Lucas', 'Matheus', 'Gabriel', 'Felipe', 'Leandro', 'Marcelo', 'Rodrigo', 'Vinícius', 'Caio', 'Thiago', 'Anderson', 'Cristiano', 'Fábio', 'Henrique', 'Luís', 'Renato', 'Wellington', 'Yago'],
    last: ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Oliveira', 'Costa', 'Rodrigues', 'Martins', 'Sousa', 'Gomes', 'Lopes', 'Marques', 'Almeida', 'Ribeiro', 'Carvalho', 'Teixeira', 'Moreira', 'Correia', 'Mendes', 'Nunes', 'Soares', 'Vieira', 'Monteiro', 'Cardoso', 'Rocha', 'Barbosa', 'Araújo', 'Nascimento', 'Lima', 'Souza', 'Cunha', 'Pinto', 'Batista', 'Freitas', 'Machado'],
  },
  latam: {
    first: ['Facundo', 'Leandro', 'Nicolás', 'Luciano', 'Gonzalo', 'Matías', 'Agustín', 'Federico', 'Juan Pablo', 'Patricio', 'Lautaro', 'Tomás', 'Franco', 'Joaquín', 'Ezequiel', 'Emanuel', 'Gabriel', 'Ramón', 'Jorge', 'Ángel', 'Edgar', 'Eddie', 'Héctor', 'Ismael', 'José Luis', 'Julio', 'Rafael', 'Wilfredo', 'Yeison', 'Eloy'],
    last: ['Fernández', 'Gómez', 'Díaz', 'Romero', 'Sosa', 'Benítez', 'Acosta', 'Medina', 'Herrera', 'Aguirre', 'Giménez', 'Quiroga', 'Ledesma', 'Molina', 'Pereyra', 'Ferreyra', 'Castro', 'Paz', 'Luna', 'Ponce', 'Godoy', 'Villalba', 'Rivera', 'Santiago', 'Colón', 'Ortiz', 'Ramos', 'Feliz', 'Peguero', 'Báez', 'Almonte', 'Batista', 'Mejía', 'Cruz', 'Polanco', 'Pimentel'],
  },
  senegal: {
    first: ['Mamadou', 'Ibrahima', 'Cheikh', 'Moussa', 'Ousmane', 'Abdoulaye', 'Aliou', 'Babacar', 'Boubacar', 'Daouda', 'El Hadji', 'Gorgui', 'Lamine', 'Mouhamed', 'Modou', 'Pape', 'Saliou', 'Seydou', 'Souleymane', 'Youssou', 'Amadou', 'Bassirou', 'Demba', 'Malick', 'Oumar', 'Samba', 'Tidiane', 'Alassane'],
    last: ['Diop', 'Ndiaye', 'Fall', 'Sow', 'Diallo', 'Gueye', 'Faye', 'Sarr', 'Mbaye', 'Cissé', 'Ba', 'Sy', 'Niang', 'Thiam', 'Seck', 'Kane', 'Diouf', 'Camara', 'Touré', 'Dieng', 'Diagne', 'Samb', 'Mbengue', 'Traoré', 'Keita', 'Coulibaly', 'Konaté', 'Sangaré', 'Dembélé', 'Sissoko'],
  },
  nigeria: {
    first: ['Chinedu', 'Emeka', 'Obinna', 'Chukwuemeka', 'Ikenna', 'Uchenna', 'Kelechi', 'Nnamdi', 'Tochukwu', 'Ifeanyi', 'Oluwaseun', 'Olumide', 'Babatunde', 'Adebayo', 'Ayodele', 'Femi', 'Kunle', 'Segun', 'Tunde', 'Yusuf', 'Ibrahim', 'Michael', 'Precious', 'Godwin', 'Stanley', 'Victor', 'Emmanuel', 'Samuel', 'Daniel', 'Joshua'],
    last: ['Okafor', 'Okonkwo', 'Eze', 'Nwosu', 'Obi', 'Okeke', 'Nwachukwu', 'Uzoma', 'Ogbonna', 'Chukwu', 'Adeyemi', 'Adebayo', 'Ogunleye', 'Olaniyan', 'Bamidele', 'Oyelaran', 'Akinola', 'Ojo', 'Afolabi', 'Balogun', 'Abubakar', 'Bello', 'Musa', 'Okoro', 'Nwankwo', 'Ibe', 'Ezenwa', 'Amadi', 'Nwafor', 'Onyeka'],
  },
  cameroon: {
    first: ['Jean-Pierre', 'Christian', 'Franck', 'Serge', 'Joël', 'Yannick', 'Hervé', 'Patrick', 'Landry', 'Ulrich', 'Arnaud', 'Rodrigue', 'Cédric', 'Junior', 'Blaise', 'Fabrice', 'Jordan', 'Brice', 'Loïc', 'Steve', 'Dieudonné', 'Aristide', 'Guy', 'Olivier', 'Pascal', 'Roland', 'Christophe', 'Yves'],
    last: ['Ngah', 'Ekotto', 'Ebanda', 'Etoundi', 'Mbarga', 'Ngono', 'Atangana', 'Essomba', 'Fouda', 'Mbida', 'Nguema', 'Owona', 'Tchakounté', 'Kamga', 'Fotso', 'Nana', 'Ndongo', 'Ekane', 'Abega', 'Bebey', 'Kalonji', 'Mukendi', 'Tshibangu', 'Kabongo', 'Ilunga', 'Lukusa', 'Kasongo', 'Bokolo', 'Nsimba', 'Mbuyi'],
  },
  romania: {
    first: ['Andrei', 'Alexandru', 'Mihai', 'Ionuț', 'Cristian', 'Florin', 'Gabriel', 'George', 'Marius', 'Răzvan', 'Bogdan', 'Cosmin', 'Vlad', 'Adrian', 'Ciprian', 'Dragoș', 'Emil', 'Lucian', 'Ovidiu', 'Radu', 'Sorin', 'Tudor', 'Valentin', 'Victor'],
    last: ['Popescu', 'Ionescu', 'Popa', 'Pop', 'Constantin', 'Stan', 'Dumitru', 'Dinu', 'Stoica', 'Gheorghe', 'Matei', 'Ciobanu', 'Ilie', 'Rusu', 'Munteanu', 'Mocanu', 'Moldovan', 'Lazăr', 'Florea', 'Diaconu', 'Barbu', 'Nistor', 'Toma', 'Cristea', 'Neagu', 'Marin'],
  },
  bulgaria: {
    first: ['Georgi', 'Ivan', 'Dimitar', 'Nikolay', 'Petar', 'Hristo', 'Stoyan', 'Todor', 'Vasil', 'Aleksandar', 'Kaloyan', 'Martin', 'Plamen', 'Stefan', 'Svetoslav', 'Valentin', 'Yordan', 'Zhivko', 'Asen', 'Boyan', 'Emil', 'Krasimir'],
    last: ['Ivanov', 'Georgiev', 'Dimitrov', 'Petrov', 'Nikolov', 'Hristov', 'Stoyanov', 'Todorov', 'Iliev', 'Vasilev', 'Atanasov', 'Petkov', 'Angelov', 'Kolev', 'Yordanov', 'Marinov', 'Stefanov', 'Popov', 'Mihaylov', 'Krastev', 'Dobrev', 'Zhelev'],
  },
  hungary: {
    first: ['László', 'István', 'Zoltán', 'Gábor', 'Péter', 'Tamás', 'Attila', 'Balázs', 'Dávid', 'Ádám', 'Bence', 'Csaba', 'Dániel', 'Gergely', 'Krisztián', 'Levente', 'Máté', 'Norbert', 'Roland', 'Szabolcs', 'Viktor', 'Zsolt'],
    last: ['Nagy', 'Kovács', 'Tóth', 'Szabó', 'Horváth', 'Varga', 'Kiss', 'Molnár', 'Németh', 'Farkas', 'Balogh', 'Papp', 'Takács', 'Juhász', 'Lakatos', 'Mészáros', 'Oláh', 'Simon', 'Rácz', 'Fekete', 'Szilágyi', 'Török'],
  },
} as const satisfies Record<string, NameList>;

export type NameOrigin = keyof typeof ORIGINS;

/** Each nationality's name origin; nationalities are spelled as the data pack spells them. */
export const NATIONALITY_ORIGINS: Readonly<Record<string, NameOrigin>> = Object.freeze({
  Spain: 'spain', Andorra: 'spain', Turkey: 'turkey', Italy: 'italy', France: 'france', Monaco: 'france', Greece: 'greece', Cyprus: 'greece',
  Germany: 'germany', Austria: 'germany', Switzerland: 'germany', USA: 'usa', Canada: 'usa', Australia: 'usa', England: 'usa', 'United Kingdom': 'usa',
  Serbia: 'serbia', Montenegro: 'serbia', 'North Macedonia': 'serbia', Croatia: 'croatia', Slovenia: 'slovenia', 'Bosnia and Herzegovina': 'bosnia',
  Lithuania: 'lithuania', Latvia: 'latvia', Poland: 'poland', Israel: 'israel', Georgia: 'georgia', Ukraine: 'ukraine', Russia: 'ukraine',
  'Czech Republic': 'czech', Slovakia: 'czech', Netherlands: 'netherlands', Belgium: 'belgium', Sweden: 'nordic', Denmark: 'nordic', Norway: 'nordic',
  Finland: 'finland', Portugal: 'portugal', Brazil: 'portugal', Argentina: 'latam', 'Dominican Republic': 'latam', 'Puerto Rico': 'latam', Uruguay: 'latam',
  Senegal: 'senegal', Mali: 'senegal', Guinea: 'senegal', Nigeria: 'nigeria', Ghana: 'nigeria', Cameroon: 'cameroon', 'DR Congo': 'cameroon', Gabon: 'cameroon',
  Romania: 'romania', Bulgaria: 'bulgaria', Hungary: 'hungary',
});

/** A club country's local nationality where the league's spelling differs or the country has no names of its own (null: every generated person is foreign). */
const LOCAL_NATIONALITY: Readonly<Record<string, string | null>> = Object.freeze({ 'United States': 'USA', 'United States of America': 'USA', Türkiye: 'Turkey', 'United Arab Emirates': null, Azerbaijan: null });

/** The local nationality of a club country (as the data pack spells it), or null when the country has no name list. */
export function localNationality(country: string | null | undefined): string | null {
  if (!country) return null;
  if (Object.hasOwn(LOCAL_NATIONALITY, country)) return LOCAL_NATIONALITY[country]!;
  return Object.hasOwn(NATIONALITY_ORIGINS, country) ? country : null;
}

type Weights = readonly (readonly [string, number])[];
/** [E] Foreign players at European clubs: Americans first, then the Balkans, the Baltics, Africa and the rest of Europe. */
const FOREIGN_PLAYERS: Weights = [
  ['USA', 40], ['Serbia', 6], ['Montenegro', 3], ['Croatia', 4], ['Bosnia and Herzegovina', 3], ['Slovenia', 3], ['Lithuania', 4], ['Latvia', 2], ['France', 4],
  ['Spain', 3], ['Italy', 2], ['Greece', 2], ['Turkey', 1], ['Germany', 2], ['Senegal', 3], ['Nigeria', 3], ['Cameroon', 2], ['Mali', 1], ['DR Congo', 1],
  ['Canada', 3], ['Australia', 2], ['Georgia', 2], ['Ukraine', 1], ['Poland', 1], ['Israel', 1], ['Netherlands', 1], ['Belgium', 1], ['Finland', 1],
  ['Czech Republic', 1], ['Argentina', 2], ['Brazil', 1], ['Dominican Republic', 1], ['Puerto Rico', 1], ['Portugal', 1], ['Sweden', 1],
];
/** [E] Foreign coaches and club presidents: the coaching countries of European basketball. */
const FOREIGN_STAFF: Weights = [
  ['Serbia', 8], ['Spain', 6], ['Italy', 5], ['Greece', 5], ['Croatia', 4], ['Lithuania', 4], ['USA', 6], ['Montenegro', 2], ['Slovenia', 3], ['Israel', 3],
  ['France', 3], ['Turkey', 3], ['Germany', 2], ['Bosnia and Herzegovina', 2], ['Latvia', 1], ['Argentina', 1], ['Georgia', 1], ['Poland', 1], ['Belgium', 1],
];
/** [E] International NBA draft prospects (about the real mix of recent drafts). */
const DRAFT_INTERNATIONAL: Weights = [
  ['France', 5], ['Canada', 6], ['Australia', 4], ['Serbia', 3], ['Spain', 2], ['Germany', 3], ['Turkey', 2], ['Greece', 2], ['Lithuania', 2], ['Slovenia', 1],
  ['Croatia', 2], ['Nigeria', 3], ['Senegal', 3], ['Cameroon', 3], ['Latvia', 1], ['Italy', 2], ['DR Congo', 1], ['Brazil', 2], ['Argentina', 1],
  ['Montenegro', 1], ['Bosnia and Herzegovina', 1], ['Israel', 1], ['Georgia', 1], ['Ukraine', 1], ['Finland', 1], ['Mali', 1], ['Dominican Republic', 1],
  ['Puerto Rico', 1], ['England', 2],
];

/**
 * Who a generated person is: each kind's share of local people (the club's country) and the list its foreigners come
 * from. [E] Next-division squads 25% foreign (owner: 20-35% in European top and second divisions); academies 12%;
 * coaches 20% (as format 74's staff); presidents 5%; NBA draft prospects mostly American, 25% international.
 */
export const GENERATED_PEOPLE_RULES = Object.freeze({
  lower: Object.freeze({ foreignShare: 0.25, foreign: FOREIGN_PLAYERS }),
  academy: Object.freeze({ foreignShare: 0.12, foreign: FOREIGN_PLAYERS }),
  coach: Object.freeze({ foreignShare: 0.2, foreign: FOREIGN_STAFF }),
  president: Object.freeze({ foreignShare: 0.05, foreign: FOREIGN_STAFF }),
  draft: Object.freeze({ foreignShare: 0.25, foreign: DRAFT_INTERNATIONAL }),
});
export type PersonKind = keyof typeof GENERATED_PEOPLE_RULES;

/** Every nationality a generated person can have. */
export const GENERATED_NATIONALITIES: readonly string[] = Object.freeze(Object.keys(NATIONALITY_ORIGINS));

/** A fixed number for a key (FNV-1a with a final avalanche), so people never draw on match randomness. */
export function peopleHash(seed: number, key: string): number {
  let value = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index += 1) value = Math.imul(value ^ key.charCodeAt(index), 16777619) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35) >>> 0;
  return (value ^ value >>> 16) >>> 0;
}

/**
 * A generated person's nationality: the club country's (`localNationality`) with the kind's local share, otherwise one
 * from the kind's foreign list (never the local one). `roll` is any fixed 32-bit number of the person.
 */
export function generatedNationality(kind: PersonKind, clubCountry: string | null, roll: number): string {
  const rules = GENERATED_PEOPLE_RULES[kind], local = kind === 'draft' ? 'USA' : localNationality(clubCountry);
  if (local && (roll % 10_000) / 10_000 >= rules.foreignShare) return local;
  const options = rules.foreign.filter(([country]) => country !== local), total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = Math.floor(roll / 10_000) % total;
  for (const [country, weight] of options) { if (pick < weight) return country; pick -= weight; }
  return options.at(-1)![0];
}

/**
 * Combinations of common names that belong to famous basketball people; generated people never take them (players
 * and coaches of the career's own world are kept clear separately, as the world's names).
 */
export const FAMOUS_NAMES: readonly string[] = Object.freeze([
  'Michael Jordan', 'Anthony Davis', 'Jaylen Brown', 'Isaiah Thomas', 'Tony Parker', 'Aaron Gordon', 'Mike James', 'Kevin Martin', 'Derrick White', 'Josh Hart',
  'Jalen Green', 'Jalen Williams', 'Cameron Johnson', 'Grant Williams', 'Reggie Jackson', 'Kyle Anderson', 'Kendrick Perkins', 'Mark Jackson', 'Scott Brooks',
  'Chris Johnson', 'Justin Jackson', 'Tyler Johnson', 'Josh Green', 'James Johnson', 'Marcus Morris', 'Jordan Clarkson', 'Kevin Johnson', 'Larry Johnson',
  'Sergio Rodríguez', 'Felipe Reyes', 'Carlos Jiménez', 'Juan Hernández', 'Dimitris Diamantidis', 'Mehmet Okur', 'Sinan Güler', 'Furkan Korkmaz', 'Oğuz Savaş',
  'Nikola Jokić', 'Bogdan Bogdanović', 'Dennis Schröder', 'Moritz Wagner', 'Andrea Bargnani', 'Marco Belinelli', 'Danilo Gallinari', 'Nicolas Batum',
  'Boris Diaw', 'Thomas Heurtel', 'Evan Fournier', 'Ivan Fernández', 'Luka Dončić',
]);

/** Accents, case and spacing aside, as names are compared ("José García" and "Jose Garcia" are one name). */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’'`´-]/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

const FAMOUS_KEYS: ReadonlySet<string> = new Set(FAMOUS_NAMES.map(nameKey));

interface Pool { first: readonly string[]; last: readonly string[]; firstKeys: readonly string[]; lastKeys: readonly string[]; step: number; earlier: readonly { first: ReadonlySet<string>; last: ReadonlySet<string> }[] }
/** A list without repeats, accents and case aside (the first spelling stays). */
const unique = (list: readonly string[]) => { const keys = new Set<string>(); return list.filter(name => !keys.has(nameKey(name)) && !!keys.add(nameKey(name))); };
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
const POOLS: ReadonlyMap<NameOrigin, Pool> = (() => {
  const pools = new Map<NameOrigin, Pool>(), seen: { first: ReadonlySet<string>; last: ReadonlySet<string> }[] = [];
  for (const origin of Object.keys(ORIGINS) as NameOrigin[]) {
    const first = unique(ORIGINS[origin].first), last = unique(ORIGINS[origin].last), size = first.length * last.length;
    let step = 7919;
    while (gcd(step, size) !== 1) step += 2;
    const firstKeys = first.map(nameKey), lastKeys = last.map(nameKey);
    pools.set(origin, { first, last, firstKeys, lastKeys, step, earlier: [...seen] });
    seen.push({ first: new Set(firstKeys), last: new Set(lastKeys) });
  }
  return pools;
})();

/** How each origin's shuffle is shared: eight slots, each kind reading its own (academies three, as they need the most). */
const SLOTS = 8;
const KIND_SLOTS: Readonly<Record<NameKind, readonly number[]>> = { lower: [0], academy: [1, 2, 3], draft: [4], coach: [5], 'coach-hire': [6], president: [7] };
export type NameKind = 'lower' | 'academy' | 'draft' | 'coach' | 'coach-hire' | 'president';

/** How many names an origin gives one kind. */
export function kindCapacity(origin: NameOrigin, kind: NameKind): number {
  const pool = POOLS.get(origin)!, size = pool.first.length * pool.last.length, slots = KIND_SLOTS[kind];
  return slots.reduce((sum, slot) => sum + Math.max(0, Math.ceil((size - slot) / SLOTS)), 0);
}

/** The j-th name of an origin for a kind, or null for a combination that repeats a word or belongs to an earlier origin. */
export function kindName(origin: NameOrigin, kind: NameKind, j: number): string | null {
  const pool = POOLS.get(origin)!, size = pool.first.length * pool.last.length, slots = KIND_SLOTS[kind];
  const position = Math.floor(j / slots.length) * SLOTS + slots[j % slots.length]!;
  if (position >= size) return null;
  const index = (position * pool.step) % size, f = index % pool.first.length, l = Math.floor(index / pool.first.length);
  if (pool.firstKeys[f] === pool.lastKeys[l]) return null;
  if (pool.earlier.some(other => other.first.has(pool.firstKeys[f]!) && other.last.has(pool.lastKeys[l]!))) return null;
  const name = `${pool.first[f]} ${pool.last[l]}`;
  return FAMOUS_KEYS.has(nameKey(name)) ? null : name;
}

/** The name origin of a nationality (the American lists for an unknown one). */
export function originOf(nationality: string): NameOrigin { return NATIONALITY_ORIGINS[nationality] ?? 'usa'; }

/**
 * A generated person's full name: the first name of the nationality's origin for this kind, from the seeded `start`,
 * whose key is not in `taken` (which then holds it). Deterministic for the same inputs.
 */
export function generatedPersonName(nationality: string, kind: NameKind, start: number, taken: Set<string>): string {
  const origin = originOf(nationality), capacity = kindCapacity(origin, kind);
  for (let attempt = 0; attempt < capacity; attempt += 1) {
    const name = kindName(origin, kind, (start + attempt) % capacity);
    if (name && !taken.has(nameKey(name))) { taken.add(nameKey(name)); return name; }
  }
  // Never reached in practice (every kind has hundreds to thousands of names per origin): a numbered name stays unique.
  for (let suffix = 2; ; suffix += 1) {
    const name = `${kindName(origin, kind, start % capacity) ?? kindName(origin, kind, 0) ?? 'Alex Smith'} ${suffix}`;
    if (!taken.has(nameKey(name))) { taken.add(nameKey(name)); return name; }
  }
}
